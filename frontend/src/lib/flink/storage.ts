import type { CallLog, ChatMessage, Contact, FlinkProfile, FlinkSimFile, PendingMessage, RoomLink, Thread } from "./types";

const DB_NAME = "flink_db";
const DB_VERSION = 2;
const LEGACY_DB_NAME = "inet_db";
const MIGRATION_KEY = "legacy-inet-v1-imported";

type LegacyRow = Record<string, unknown>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ["profile", "sim", "contacts", "threads", "messages", "calls", "rooms", "outbox", "settings"] as const) {
        if (!db.objectStoreNames.contains(name)) {
          const key = name === "messages" || name === "threads" || name === "calls" || name === "rooms" || name === "outbox" ? "id" : "key";
          const store = db.createObjectStore(name, { keyPath: key });
          if (name === "messages") store.createIndex("threadId", "threadId");
        }
      }
    };
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readLegacyDatabase(): Promise<{ db: IDBDatabase; created: boolean } | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB_NAME);
    let created = false;
    req.onupgradeneeded = (event) => { created = event.oldVersion === 0; };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve({ db: req.result, created });
  });
}

function readLegacyStore<T>(db: IDBDatabase, name: string): Promise<T[]> {
  if (!db.objectStoreNames.contains(name)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const req = db.transaction(name, "readonly").objectStore(name).getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export const flinkStorage = {
  async migrateLegacyData() {
    const done = await tx<{ key: string; value: boolean }>("settings", "readonly", (s) => s.get(MIGRATION_KEY));
    if (done?.value) return;

    let legacy: { db: IDBDatabase; created: boolean } | null = null;
    try {
      legacy = await readLegacyDatabase();
      if (!legacy || legacy.created || legacy.db.objectStoreNames.length === 0) {
        legacy?.db.close();
        if (legacy?.created) indexedDB.deleteDatabase(LEGACY_DB_NAME);
        await tx("settings", "readwrite", (s) => s.put({ key: MIGRATION_KEY, value: true }));
        return;
      }

      const db = legacy.db;
      const [profiles, contacts, oldMessages, oldCalls] = await Promise.all([
        readLegacyStore<LegacyRow>(db, "profile"),
        readLegacyStore<LegacyRow>(db, "contacts"),
        readLegacyStore<LegacyRow>(db, "messages"),
        readLegacyStore<LegacyRow>(db, "call_log"),
      ]);
      db.close();

      const oldProfile = profiles.find((row) => row.key === "user");
      const number = String(oldProfile?.flinkNumber ?? "");
      if (oldProfile && /^\d{6}$/.test(number) && typeof oldProfile.deviceId === "string") {
        const profile: FlinkProfile = {
          flinkNumber: number,
          deviceId: oldProfile.deviceId,
          simId: String(oldProfile.simId ?? oldProfile.deviceId),
          accessToken: String(oldProfile.accessToken ?? ""),
          password: typeof oldProfile.password === "string" ? oldProfile.password : undefined,
          createdAt: Number(oldProfile.createdAt ?? Date.now()),
        };
        await this.saveProfile(profile);
        localStorage.setItem("flink_device_id", profile.deviceId);
      }

      for (const row of contacts) {
        const flinkNumber = String(row.flinkNumber ?? "");
        if (!/^\d{6}$/.test(flinkNumber)) continue;
        const contact: Contact = {
          flinkNumber,
          name: String(row.name ?? flinkNumber),
          lastSeen: Number(row.lastSeen ?? row.addedAt ?? Date.now()),
        };
        await this.putContact(contact);
      }

      const imported: ChatMessage[] = [];
      for (const row of oldMessages) {
        if (row.groupId || typeof row.from !== "string" || typeof row.to !== "string") continue;
        const other = row.from === number ? row.to : row.from;
        if (!/^\d{6}$/.test(other) || typeof row.id !== "string") continue;
        const oldType = String(row.type ?? "text");
        const kind: ChatMessage["kind"] = oldType === "image" ? "image" : oldType === "text" ? "text" : "system";
        const legacyContent = typeof row.content === "string" ? row.content : "";
        const message: ChatMessage = {
          id: row.id,
          threadId: `d-${other}`,
          from: row.from,
          kind,
          text: kind === "text" ? legacyContent : kind === "system" ? `[${oldType} from previous app]` : undefined,
          imageUrl: kind === "image" ? legacyContent : undefined,
          ts: Number(row.time ?? Date.now()),
          mine: row.from === number,
        };
        await this.putMessage(message);
        imported.push(message);
      }

      const latestByPeer = new Map<string, ChatMessage>();
      for (const message of imported) {
        const peer = message.threadId.slice(2);
        const latest = latestByPeer.get(peer);
        if (!latest || message.ts >= latest.ts) latestByPeer.set(peer, message);
      }
      for (const [peer, latest] of latestByPeer) {
        await this.putThread({
          id: `d-${peer}`,
          kind: "direct",
          title: peer,
          peerNumber: peer,
          lastText: latest.kind === "image" ? "Photo" : latest.text ?? "",
          lastTs: latest.ts,
        });
      }

      for (const row of oldCalls) {
        const peer = String(row.flinkNumber ?? "");
        if (!/^\d{6}$/.test(peer) || typeof row.id !== "string") continue;
        const call: CallLog = {
          id: row.id,
          peer,
          mode: row.type === "video" ? "video" : "voice",
          direction: row.direction === "incoming" ? "in" : "out",
          status: row.status === "missed" ? "missed" : row.status === "rejected" ? "declined" : row.status === "calling" ? "calling" : "ended",
          ts: Number(row.time ?? Date.now()),
        };
        await this.putCall(call);
      }

      await tx("settings", "readwrite", (s) => s.put({ key: MIGRATION_KEY, value: true }));
    } catch (error) {
      legacy?.db.close();
      console.warn("Legacy Flink data migration will retry next launch", error);
    }
  },

  async getProfile(): Promise<FlinkProfile | null> {
    const row = await tx<{ key: string } & FlinkProfile>("profile", "readonly", (s) => s.get("user"));
    return row ?? null;
  },
  async saveProfile(profile: FlinkProfile) {
    await tx("profile", "readwrite", (s) => s.put({ key: "user", ...profile }));
  },
  async clearProfile() {
    await tx("profile", "readwrite", (s) => s.delete("user"));
  },

  async getSim(): Promise<FlinkSimFile | null> {
    const row = await tx<{ key: string; value: FlinkSimFile }>("sim", "readonly", (s) => s.get("current"));
    return row?.value ?? null;
  },
  async saveSim(sim: FlinkSimFile) {
    await tx("sim", "readwrite", (s) => s.put({ key: "current", value: sim }));
  },

  async getContacts(): Promise<Contact[]> {
    return (await tx<Contact[]>("contacts", "readonly", (s) => s.getAll())) ?? [];
  },
  async putContact(c: Contact) {
    await tx("contacts", "readwrite", (s) => s.put({ key: c.flinkNumber, ...c }));
  },

  async getThreads(): Promise<Thread[]> {
    const all = (await tx<Thread[]>("threads", "readonly", (s) => s.getAll())) ?? [];
    return all.sort((a, b) => b.lastTs - a.lastTs);
  },
  async putThread(t: Thread) {
    await tx("threads", "readwrite", (s) => s.put(t));
  },

  async getMessages(threadId: string): Promise<ChatMessage[]> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction("messages", "readonly");
      const idx = t.objectStore("messages").index("threadId");
      const req = idx.getAll(threadId);
      req.onsuccess = () => {
        const rows = (req.result as ChatMessage[]).sort((a, b) => a.ts - b.ts);
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  },
  async putMessage(m: ChatMessage) {
    await tx("messages", "readwrite", (s) => s.put(m));
  },
  async deleteMessage(id: string) {
    await tx("messages", "readwrite", (s) => s.delete(id));
  },

  async updateMessageStatus(id: string, status: "pending" | "sent" | "delivered" | "read") {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("messages", "readwrite");
      const req = t.objectStore("messages").get(id);
      req.onsuccess = () => {
        const msg = req.result as ChatMessage;
        if (msg) {
          msg.status = status;
          const updateReq = t.objectStore("messages").put(msg);
          updateReq.onsuccess = () => resolve();
          updateReq.onerror = () => reject(updateReq.error);
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getCalls(): Promise<CallLog[]> {
    const all = (await tx<CallLog[]>("calls", "readonly", (s) => s.getAll())) ?? [];
    return all.sort((a, b) => b.ts - a.ts);
  },
  async putCall(c: CallLog) {
    await tx("calls", "readwrite", (s) => s.put(c));
  },
  async getRooms(): Promise<RoomLink[]> {
    const all = (await tx<RoomLink[]>("rooms", "readonly", (s) => s.getAll())) ?? [];
    return all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  },
  async putRoom(room: RoomLink) {
    await tx("rooms", "readwrite", (s) => s.put(room));
  },
  async deleteRoom(id: string) {
    await tx("rooms", "readwrite", (s) => s.delete(id));
  },
  async getOutbox(): Promise<PendingMessage[]> {
    return (await tx<PendingMessage[]>("outbox", "readonly", (s) => s.getAll())) ?? [];
  },
  async putOutbox(message: PendingMessage) {
    await tx("outbox", "readwrite", (s) => s.put(message));
  },
  async deleteOutbox(id: string) {
    await tx("outbox", "readwrite", (s) => s.delete(id));
  },

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const row = await tx<{ key: string; value: T }>("settings", "readonly", (s) => s.get(key));
    return row ? row.value : fallback;
  },
  async setSetting<T>(key: string, value: T) {
    await tx("settings", "readwrite", (s) => s.put({ key, value }));
  },

  async wipe() {
    const db = await openDb();
    await Promise.all(
      ["profile", "sim", "contacts", "threads", "messages", "calls", "rooms", "outbox", "settings"].map(
        (name) =>
          new Promise<void>((resolve, reject) => {
            const t = db.transaction(name, "readwrite");
            const req = t.objectStore(name).clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          }),
      ),
    );
    localStorage.removeItem("flink_device_id");
  },
};
