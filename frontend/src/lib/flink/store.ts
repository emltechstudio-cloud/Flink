import { create } from "zustand";
import { toast } from "sonner";
import { downloadJson, randomId, sessionId } from "@/lib/utils";
import { flinkApi } from "./api";
import { registerFlinkPush } from "./push";
import { dropMailbox, SignalingSocket } from "./signaling";
import { FlinkSession } from "./session";
import { flinkStorage } from "./storage";
import { startRingtone, stopRingtone } from "./ringtone";
import type {
  AppView,
  CallLog,
  ChatMessage,
  CommMode,
  Contact,
  FlinkGroup,
  FlinkProfile,
  FlinkSimFile,
  IncomingRequest,
  PeerStatus,
  Reaction,
  RoomLink,
  RoomParticipant,
  Thread,
} from "./types";

type RemoteMedia = { id: string; stream: MediaStream; kind?: "camera" | "screen" };

function ensureAudioContext() {
  if (typeof window !== "undefined") {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContext) {
      const ctx = new AudioContext();
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    }
  }
}

type FlinkState = {
  boot: "loading" | "auth" | "ready";
  view: AppView;
  profile: FlinkProfile | null;
  sim: FlinkSimFile | null;
  contacts: Contact[];
  threads: Thread[];
  messages: ChatMessage[];
  calls: CallLog[];
  groups: FlinkGroup[];
  rooms: RoomLink[];
  activeThread: Thread | null;
  incoming: IncomingRequest | null;
  outgoing: { to: string; mode: CommMode; sessionId: string } | null;
  session: FlinkSession | null;
  callStatus: string;
  remoteMedia: RemoteMedia[];
  muted: boolean;
  videoOff: boolean;
  mailbox: SignalingSocket | null;
  busy: boolean;
  notice: string | null;
  peerStatuses: Map<string, PeerStatus>;
  sessionEnded: boolean;
  roomParticipants: Map<string, RoomParticipant>;
  screenStream: MediaStream | null;
  localCameraStream: MediaStream | null;
  isScreenSharing: boolean;

  bootApp: () => Promise<void>;
  createAccount: (password: string) => Promise<void>;
  continueDevice: () => Promise<void>;
  continuePassword: (number: string, password: string) => Promise<void>;
  continueSimFile: (file: File) => Promise<void>;
  downloadSim: () => void;
  logout: () => Promise<void>;
  setView: (view: AppView) => void;
  refreshGroups: () => Promise<void>;
  createGroup: (name: string, members: string[]) => Promise<void>;
  addGroupMembers: (groupId: string, members: string[]) => Promise<void>;
  approach: (target: string, mode: CommMode) => Promise<void>;
  approachGroup: (group: FlinkGroup, mode: CommMode) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  declineIncoming: () => void;
  cancelOutgoing: () => void;
  openThread: (thread: Thread) => Promise<void>;
  startChat: (number: string) => Promise<void>;
  sendText: (text: string) => Promise<void>;
  sendImage: (file: File, caption?: string) => Promise<void>;
  sendVoiceNote: (file: File) => Promise<void>;
  sendVideo: (file: File, caption?: string) => Promise<void>;
  sendGif: (file: File) => Promise<void>;
  sendFile: (file: File) => Promise<void>;
  addReaction: (messageId: string, emoji: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  hangup: () => void;
  endSession: () => void;
  toggleScreenShare: () => Promise<void>;
  updatePeerStatus: (number: string, online: boolean, sessionActive?: boolean, inCall?: boolean) => void;
  updateParticipant: (number: string, updates: Partial<RoomParticipant>) => void;
  markMessageDelivered: (messageId: string) => Promise<void>;
  markMessageRead: (messageId: string) => Promise<void>;
  startNewSession: (peerNumber: string) => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
  startRoom: (mode: CommMode, title: string) => { id: string; url: string };
  upsertContact: (number: string, name?: string) => Promise<void>;
};

function deviceId() {
  const existing = localStorage.getItem("flink_device_id");
  if (existing && existing.length >= 8) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem("flink_device_id", id);
  return id;
}

function threadIdFor(number: string) {
  return `d-${number}`;
}

async function mediaFor(mode: CommMode) {
  if (mode === "chat" || mode === "ping") return undefined;
  if (mode === "screen") {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing is not supported by this browser.");
    try {
      return await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch {
      return undefined;
    }
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera and microphone access is not supported by this browser.");
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: mode === "video" ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false,
  });
}

export const useFlink = create<FlinkState>((set, get) => ({
  boot: "loading",
  view: "home",
  profile: null,
  sim: null,
  contacts: [],
  threads: [],
  messages: [],
  calls: [],
  groups: [],
  rooms: [],
  activeThread: null,
  incoming: null,
  outgoing: null,
  session: null,
  callStatus: "",
  remoteMedia: [],
  muted: false,
  videoOff: false,
  mailbox: null,
  busy: false,
  notice: null,
  peerStatuses: new Map(),
  sessionEnded: false,
  roomParticipants: new Map(),
  screenStream: null,
  localCameraStream: null,
  isScreenSharing: false,

  async bootApp() {
    try {
      await flinkStorage.migrateLegacyData();
      const profile = await flinkStorage.getProfile();
      const sim = await flinkStorage.getSim();
      const contacts = await flinkStorage.getContacts();
      const threads = await flinkStorage.getThreads();
      const calls = await flinkStorage.getCalls();
      const rooms = await flinkStorage.getRooms();
      if (profile?.accessToken) {
        try {
          await flinkApi.me(profile.accessToken);
          set({ profile, sim, contacts, threads, calls, rooms, boot: "ready" });
          await get().refreshGroups();
          startMailbox();
          void registerFlinkPush(profile.accessToken);
          return;
        } catch {
          if (profile.deviceId) {
            try {
              await get().continueDevice();
              return;
            } catch {
              /* fall through */
            }
          }
        }
      }
      set({ sim, contacts, threads, calls, rooms, boot: "auth" });
    } catch {
      set({ boot: "auth" });
    }
  },

  async createAccount(password) {
    set({ busy: true, notice: null });
    try {
      const device = deviceId();
      const simId = crypto.randomUUID();
      const res = await flinkApi.createAccount(password, device, simId);
      const profile: FlinkProfile = {
        flinkNumber: res.flink_number ?? "",
        deviceId: device,
        simId,
        accessToken: res.access_token,
        password,
        createdAt: Date.now(),
      };
      await flinkStorage.saveProfile(profile);
      let sim: FlinkSimFile | null = null;
      try {
        const signed = await flinkApi.signSim(profile.flinkNumber, simId, { device: "browser" });
        sim = {
          kind: "flink-sim",
          version: 1,
          payload: signed.payload,
          signature: signed.signature,
          algorithm: signed.algorithm,
          public_key: signed.public_key,
          password,
          deviceId: device,
          simId,
        };
        await flinkStorage.saveSim(sim);
      } catch {
        /* signing optional if keys missing */
      }
      set({ profile, sim, boot: "ready", busy: false, view: "you" });
      startMailbox();
      void registerFlinkPush(profile.accessToken);
      toast.success("Your Flink number is ready");
    } catch (err) {
      set({ busy: false, notice: err instanceof Error ? err.message : "Could not create account" });
      throw err;
    }
  },

  async continueDevice() {
    set({ busy: true, notice: null });
    try {
      const id = deviceId();
      const res = await flinkApi.continueDevice(id);
      const prev = await flinkStorage.getProfile();
      const profile: FlinkProfile = {
        flinkNumber: res.flink_number ?? prev?.flinkNumber ?? "",
        deviceId: id,
        simId: prev?.simId ?? id,
        accessToken: res.access_token,
        password: prev?.password,
        createdAt: prev?.createdAt ?? Date.now(),
      };
      await flinkStorage.saveProfile(profile);
      const sim = await flinkStorage.getSim();
      const contacts = await flinkStorage.getContacts();
      const threads = await flinkStorage.getThreads();
      const calls = await flinkStorage.getCalls();
      const rooms = await flinkStorage.getRooms();
      set({ profile, sim, contacts, threads, calls, rooms, boot: "ready", busy: false, view: "home" });
      startMailbox();
      void registerFlinkPush(profile.accessToken);
      await get().refreshGroups();
    } catch (err) {
      set({ busy: false, notice: err instanceof Error ? err.message : "This device is not registered" });
      throw err;
    }
  },

  async continuePassword(number, password) {
    set({ busy: true, notice: null });
    try {
      const res = await flinkApi.continuePassword(number, password);
      const device = deviceId();
      const profile: FlinkProfile = {
        flinkNumber: number,
        deviceId: device,
        simId: crypto.randomUUID(),
        accessToken: res.access_token,
        password,
        createdAt: Date.now(),
      };
      await flinkStorage.saveProfile(profile);
      set({ profile, boot: "ready", busy: false, view: "home" });
      startMailbox();
      void registerFlinkPush(profile.accessToken);
      await get().refreshGroups();
    } catch (err) {
      set({ busy: false, notice: err instanceof Error ? err.message : "Could not continue with password" });
      throw err;
    }
  },

  async continueSimFile(file) {
    set({ busy: true, notice: null });
    try {
      const parsed = JSON.parse(await file.text()) as Partial<FlinkSimFile> & {
        flinkNumber?: string;
        payload?: Record<string, unknown>;
        signature?: string;
        password?: string;
      };
      if (parsed.payload && parsed.signature) {
        const res = await flinkApi.continueSim(parsed.payload, parsed.signature);
        const device = deviceId();
        const profile: FlinkProfile = {
          flinkNumber: res.flink_number ?? String(parsed.payload.flink_number ?? ""),
          deviceId: parsed.deviceId ?? device,
          simId: parsed.simId ?? String(parsed.payload.sim_id ?? crypto.randomUUID()),
          accessToken: res.access_token,
          password: parsed.password,
          createdAt: Date.now(),
        };
        await flinkStorage.saveProfile(profile);
        await flinkStorage.saveSim({
          kind: "flink-sim",
          version: 1,
          payload: parsed.payload,
          signature: parsed.signature,
          algorithm: parsed.algorithm ?? "Ed25519",
          public_key: parsed.public_key,
          password: parsed.password,
          deviceId: profile.deviceId,
          simId: profile.simId,
        });
        set({ profile, sim: parsed as FlinkSimFile, boot: "ready", busy: false, view: "home" });
        startMailbox();
        void registerFlinkPush(profile.accessToken);
        await get().refreshGroups();
        return;
      }
      if (parsed.flinkNumber && parsed.password && /^\d{6}$/.test(parsed.flinkNumber)) {
        await get().continuePassword(parsed.flinkNumber, parsed.password);
        return;
      }
      throw new Error("This file is not a valid Flink SIM");
    } catch (err) {
      set({ busy: false, notice: err instanceof Error ? err.message : "Could not read SIM" });
      throw err;
    }
  },

  downloadSim() {
    const { sim, profile } = get();
    if (sim) {
      downloadJson(`flink-${profile?.flinkNumber ?? "sim"}.sim.json`, sim);
      return;
    }
    if (profile) {
      downloadJson(`flink-${profile.flinkNumber}.sim.json`, {
        kind: "flink-sim",
        version: 1,
        note: "Re-issue a signed SIM from this device after opening Flink.",
        flinkNumber: profile.flinkNumber,
        deviceId: profile.deviceId,
        simId: profile.simId,
        password: profile.password,
      });
    }
  },

  async logout() {
    get().mailbox?.close();
    get().session?.close();
    await flinkStorage.wipe();
    set({
      boot: "auth",
      profile: null,
      sim: null,
      session: null,
      mailbox: null,
      incoming: null,
      outgoing: null,
      view: "home",
      groups: [],
      rooms: [],
      threads: [],
      messages: [],
      contacts: [],
    });
  },

  setView(view) {
    set({ view });
  },

  async refreshGroups() {
    const token = get().profile?.accessToken;
    if (!token) return;
    try {
      const res = await flinkApi.listGroups(token);
      set({ groups: res.groups });
    } catch {
      /* groups optional */
    }
  },

  async createGroup(name, members) {
    const token = get().profile?.accessToken;
    if (!token) return;
    const res = await flinkApi.createGroup(token, name, members.filter((n) => /^\d{6}$/.test(n)));
    set({ groups: [res.group, ...get().groups] });
    toast.success("Group created");
  },

  async addGroupMembers(groupId, members) {
    const token = get().profile?.accessToken;
    if (!token) return;
    const nums = members.filter((n) => /^\d{6}$/.test(n));
    if (nums.length === 0) return;
    const res = await flinkApi.addGroupMembers(token, groupId, nums);
    set({ groups: get().groups.map((group) => group.group_id === groupId ? res.group : group) });
    toast.success("Participants added");
  },

  async approach(target, mode) {
    const profile = get().profile;
    if (!profile) return;
    if (target === profile.flinkNumber) {
      toast.error("That is your own number");
      return;
    }
    if (!/^\d{6}$/.test(target)) {
      toast.error("Enter a six-digit Flink number");
      return;
    }
    const sid = sessionId("s");
    set({ busy: true, outgoing: { to: target, mode, sessionId: sid }, callStatus: "Approaching…" });
    try {
      await flinkApi.ping(profile.accessToken, target, mode, sid);
      void dropMailbox(
        target,
        {
          from: profile.flinkNumber,
          mode,
          session_id: sid,
        },
        profile.accessToken,
      );
      await get().upsertContact(target);
      const log: CallLog = {
        id: randomId(12),
        peer: target,
        mode,
        direction: "out",
        status: "calling",
        ts: Date.now(),
      };
      await flinkStorage.putCall(log);
      set({ calls: [log, ...get().calls], busy: false });
      await joinSession(sid, mode, target);
    } catch (err) {
      set({ busy: false, outgoing: null });
      toast.error(err instanceof Error ? err.message : "Could not send the request");
    }
  },

  async approachGroup(group, mode) {
    const profile = get().profile;
    if (!profile) return;
    const sid = sessionId("g");
    set({
      busy: true,
      outgoing: { to: group.name, mode, sessionId: sid },
      callStatus: `Approaching ${group.name}…`,
    });
    try {
      await flinkApi.groupPing(profile.accessToken, group.group_id, mode, sid);
      for (const member of group.members) {
        if (member !== profile.flinkNumber) {
          void dropMailbox(
            member,
            {
              from: profile.flinkNumber,
              mode,
              session_id: sid,
              group_id: group.group_id,
              group_name: group.name,
            },
            profile.accessToken,
          );
        }
      }
      set({ busy: false });
      await joinSession(sid, mode, group.name);
    } catch (err) {
      set({ busy: false, outgoing: null });
      toast.error(err instanceof Error ? err.message : "Could not ping the group");
    }
  },

  async acceptIncoming() {
    const incoming = get().incoming;
    if (!incoming) return;
    stopRingtone();
    set({ incoming: null });
    await joinSession(incoming.sessionId, incoming.mode, incoming.from);
  },

  declineIncoming() {
    const incoming = get().incoming;
    stopRingtone();
    set({ incoming: null });
    if (incoming) {
      const token = get().profile?.accessToken;
      void dropMailbox(incoming.from, { type: "declined", session_id: incoming.sessionId }, token);
    }
  },

  cancelOutgoing() {
    get().session?.close();
    set({ session: null, outgoing: null, remoteMedia: [], callStatus: "" });
  },

  async openThread(thread) {
    const messages = await flinkStorage.getMessages(thread.id);
    set({ activeThread: thread, messages, view: "chat" });
  },

  async startChat(number) {
    if (!/^\d{6}$/.test(number) || number === get().profile?.flinkNumber) {
      toast.error("Enter a valid six-digit Flink number");
      return;
    }
    await get().approach(number, "chat");
  },

  async sendText(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const thread = get().activeThread;
    const profile = get().profile;
    if (!thread || !profile) return;
    const msg: ChatMessage = {
      id: randomId(10),
      threadId: thread.id,
      from: profile.flinkNumber,
      kind: "text",
      text: trimmed,
      ts: Date.now(),
      mine: true,
      status: "sent",
    };
    await flinkStorage.putMessage(msg);
    const next = { ...thread, lastText: trimmed, lastTs: msg.ts };
    await flinkStorage.putThread(next);
    set({
      messages: [...get().messages, msg],
      threads: [next, ...get().threads.filter((t) => t.id !== next.id)],
      activeThread: next,
    });
    get().session?.sendChat({ kind: "text", text: trimmed, id: msg.id, ts: msg.ts });
  },

  async sendImage(file, caption = "") {
    if (file.size > 180_000) {
      toast.error("Keep images under 180 KB for peer transfer");
      return;
    }
    const thread = get().activeThread;
    const profile = get().profile;
    if (!thread || !profile) return;
    const dataUrl = await fileToDataUrl(file);
    const msg: ChatMessage = {
      id: randomId(10),
      threadId: thread.id,
      from: profile.flinkNumber,
      kind: "image",
      caption: caption.trim() || undefined,
      imageUrl: dataUrl,
      ts: Date.now(),
      mine: true,
      status: "sent",
    };
    await flinkStorage.putMessage(msg);
    const next = { ...thread, lastText: "Photo", lastTs: msg.ts };
    await flinkStorage.putThread(next);
    set({
      messages: [...get().messages, msg],
      threads: [next, ...get().threads.filter((t) => t.id !== next.id)],
      activeThread: next,
    });
    get().session?.sendChat({ kind: "image", image: dataUrl, caption: msg.caption, id: msg.id, ts: msg.ts });
  },

  hangup() {
    get().session?.close();
    set({ session: null, outgoing: null, incoming: null, remoteMedia: [], callStatus: "", muted: false, videoOff: false, sessionEnded: true, isScreenSharing: false, screenStream: null, localCameraStream: null, roomParticipants: new Map() });
  },

  endSession() {
    get().session?.close();
    set({ session: null, outgoing: null, incoming: null, remoteMedia: [], callStatus: "", muted: false, videoOff: false, sessionEnded: true, isScreenSharing: false, screenStream: null, localCameraStream: null, roomParticipants: new Map() });
  },

  async startNewSession(peerNumber: string) {
    const profile = get().profile;
    if (!profile) return;
    set({ sessionEnded: false });
    await get().approach(peerNumber, "chat");
  },

  updatePeerStatus(number: string, online: boolean, sessionActive?: boolean, inCall?: boolean) {
    set((s) => {
      const statuses = new Map(s.peerStatuses);
      statuses.set(number, {
        flinkNumber: number,
        online,
        lastSeen: Date.now(),
        sessionActive: sessionActive ?? false,
        inCall,
      });
      return { peerStatuses: statuses };
    });
  },

  updateParticipant(number: string, updates: Partial<RoomParticipant>) {
    set((s) => {
      const participants = new Map(s.roomParticipants);
      const existing = participants.get(number);
      participants.set(number, { ...existing, ...updates } as RoomParticipant);
      return { roomParticipants: participants };
    });
  },

  async markMessageDelivered(messageId: string) {
    const messages = get().messages;
    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex !== -1 && messages[msgIndex].status !== "read") {
      const msg = messages[msgIndex];
      const updatedMsg: ChatMessage = { ...msg, status: "delivered" as const };
      await flinkStorage.putMessage(updatedMsg);
      set((s) => ({
        messages: s.messages.map((m) => (m.id === messageId ? updatedMsg : m)),
      }));
      get().session?.sendChat({ kind: "receipt", messageId, status: "delivered" as const, ts: Date.now(), id: messageId });
    }
  },

  async markMessageRead(messageId: string) {
    const messages = get().messages;
    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex !== -1 && messages[msgIndex].status !== "read") {
      const msg = messages[msgIndex];
      const updatedMsg: ChatMessage = { ...msg, status: "read" as const };
      await flinkStorage.putMessage(updatedMsg);
      set((s) => ({
        messages: s.messages.map((m) => (m.id === messageId ? updatedMsg : m)),
      }));
      get().session?.sendChat({ kind: "receipt", messageId, status: "read" as const, ts: Date.now(), id: messageId });
    }
  },

  async sendVoiceNote(file: File) {
    if (file.size > 5_000_000) {
      toast.error("Keep voice notes under 5 MB");
      return;
    }
    const thread = get().activeThread;
    const profile = get().profile;
    if (!thread || !profile) return;
    ensureAudioContext();
    const dataUrl = await fileToDataUrl(file);
    const msg: ChatMessage = {
      id: randomId(10),
      threadId: thread.id,
      from: profile.flinkNumber,
      kind: "voice",
      audioUrl: dataUrl,
      ts: Date.now(),
      mine: true,
      status: "sent" as const,
      duration: Math.round(file.size / 1000),
    };
    await flinkStorage.putMessage(msg);
    const next = { ...thread, lastText: "Voice note", lastTs: msg.ts };
    await flinkStorage.putThread(next);
    set({
      messages: [...get().messages, msg],
      threads: [next, ...get().threads.filter((t) => t.id !== next.id)],
      activeThread: next,
    });
    get().session?.sendChat({ kind: "voice", audio: dataUrl, id: msg.id, ts: msg.ts, duration: msg.duration });
  },

  async sendVideo(file, caption = "") {
    if (file.size > 50_000_000) {
      toast.error("Keep videos under 50 MB");
      return;
    }
    const thread = get().activeThread;
    const profile = get().profile;
    if (!thread || !profile) return;
    const dataUrl = await fileToDataUrl(file);
    const msg: ChatMessage = {
      id: randomId(10),
      threadId: thread.id,
      from: profile.flinkNumber,
      kind: "video",
      caption: caption.trim() || undefined,
      videoUrl: dataUrl,
      ts: Date.now(),
      mine: true,
      status: "sent" as const,
      duration: Math.round(file.size / 1000),
    };
    await flinkStorage.putMessage(msg);
    const next = { ...thread, lastText: "Video", lastTs: msg.ts };
    await flinkStorage.putThread(next);
    set({
      messages: [...get().messages, msg],
      threads: [next, ...get().threads.filter((t) => t.id !== next.id)],
      activeThread: next,
    });
    get().session?.sendChat({ kind: "video", video: dataUrl, caption: msg.caption, id: msg.id, ts: msg.ts, duration: msg.duration });
  },

  async sendGif(file: File) {
    if (file.size > 5_000_000) {
      toast.error("Keep GIFs under 5 MB");
      return;
    }
    const thread = get().activeThread;
    const profile = get().profile;
    if (!thread || !profile) return;
    const dataUrl = await fileToDataUrl(file);
    const msg: ChatMessage = {
      id: randomId(10),
      threadId: thread.id,
      from: profile.flinkNumber,
      kind: "gif",
      imageUrl: dataUrl,
      ts: Date.now(),
      mine: true,
      status: "sent" as const,
    };
    await flinkStorage.putMessage(msg);
    const next = { ...thread, lastText: "GIF", lastTs: msg.ts };
    await flinkStorage.putThread(next);
    set({
      messages: [...get().messages, msg],
      threads: [next, ...get().threads.filter((t) => t.id !== next.id)],
      activeThread: next,
    });
    get().session?.sendChat({ kind: "gif", image: dataUrl, id: msg.id, ts: msg.ts });
  },

  async sendFile(file: File) {
    if (file.size > 5_000_000) {
      toast.error("Keep files under 5 MB for peer transfer");
      return;
    }
    const thread = get().activeThread;
    const profile = get().profile;
    if (!thread || !profile) return;
    const dataUrl = await fileToDataUrl(file);
    const msg: ChatMessage = {
      id: randomId(10),
      threadId: thread.id,
      from: profile.flinkNumber,
      kind: "file",
      fileUrl: dataUrl,
      fileName: file.name,
      ts: Date.now(),
      mine: true,
      status: "sent",
    };
    await flinkStorage.putMessage(msg);
    const next = { ...thread, lastText: file.name, lastTs: msg.ts };
    await flinkStorage.putThread(next);
    set({
      messages: [...get().messages, msg],
      threads: [next, ...get().threads.filter((t) => t.id !== next.id)],
      activeThread: next,
    });
    get().session?.sendChat({ kind: "file", file: dataUrl, fileName: file.name, id: msg.id, ts: msg.ts });
  },

  async addReaction(messageId: string, emoji: string) {
    const messages = get().messages;
    const profile = get().profile;
    if (!profile) return;
    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;
    const msg = messages[msgIndex];
    const reactions = msg.reactions ?? {};
    const existing = reactions[emoji];
    const newReaction: Reaction = {
      emoji,
      count: existing ? existing.count + 1 : 1,
      users: existing ? [...existing.users, profile.flinkNumber] : [profile.flinkNumber],
    };
    const updatedMsg: ChatMessage = { ...msg, reactions: { ...reactions, [emoji]: newReaction } };
    await flinkStorage.putMessage(updatedMsg);
    set((s) => ({
      messages: s.messages.map((m) => (m.id === messageId ? updatedMsg : m)),
    }));
    get().session?.sendChat({ kind: "reaction", messageId, emoji, ts: Date.now(), id: messageId });
  },

  async deleteMessage(messageId: string) {
    await flinkStorage.deleteMessage(messageId);
    set((state) => ({ messages: state.messages.filter((message) => message.id !== messageId) }));
  },
  async toggleScreenShare() {
    const session = get().session;
    const isSharing = get().isScreenSharing;
    if (!session) {
      toast.error("No active session");
      return;
    }
    if (isSharing) {
      get().screenStream?.getTracks().forEach((t) => t.stop());
      set({ isScreenSharing: false, screenStream: null });
      const camera = get().localCameraStream;
      if (camera) session.attachLocal(camera);
      session.sendChat({ kind: "screen_stop", ts: Date.now(), id: randomId(10) });
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        set({ isScreenSharing: true, screenStream: stream });
        session.attachLocal(stream);
        get().session?.sendChat({ kind: "screen_start", ts: Date.now(), id: randomId(10) });
      } catch (err) {
        toast.error("Screen sharing denied");
      }
    }
  },

  toggleMute() {
    const next = !get().muted;
    get().session?.mute(next);
    set({ muted: next });
  },

  toggleVideo() {
    const next = !get().videoOff;
    get().session?.setVideo(!next);
    set({ videoOff: next });
  },

  startRoom(mode, title) {
    const id = sessionId("r");
    const base = new URL(import.meta.env.BASE_URL, window.location.href).toString();
    const params = new URLSearchParams({ mode, title: title || "Room" });
    const url = `${base}#room/${encodeURIComponent(id)}?${params.toString()}`;
    const now = Date.now();
    const room: RoomLink = { id, title: title || "Room", mode, url, hostNumber: get().profile?.flinkNumber, createdAt: now, lastOpenedAt: now };
    void flinkStorage.putRoom(room);
    set((state) => ({ rooms: [room, ...state.rooms.filter((item) => item.id !== id)] }));
    return { id, url };
  },

  async upsertContact(number, name) {
    const existing = get().contacts.find((c) => c.flinkNumber === number);
    const contact: Contact = {
      flinkNumber: number,
      name: name || existing?.name || number,
      lastSeen: Date.now(),
    };
    await flinkStorage.putContact(contact);
    set({ contacts: [contact, ...get().contacts.filter((c) => c.flinkNumber !== number)] });
  },
}));

function startMailbox() {
  const { profile, mailbox } = useFlink.getState();
  if (!profile) return;
  mailbox?.close();
  const sock = new SignalingSocket(`mb-${profile.flinkNumber}`, profile.accessToken, {
    onEvent: (event) => {
      if (event.type !== "flink_request") return;
      const payload = (event.payload ?? {}) as {
        from?: string;
        mode?: CommMode;
        session_id?: string;
        group_id?: string;
        group_name?: string;
      };
      if (!payload.session_id || !payload.from) return;
      if (payload.from === profile.flinkNumber) return;
      startRingtone();
      useFlink.setState({
        incoming: {
          from: payload.from,
          mode: payload.mode ?? "ping",
          sessionId: payload.session_id,
          groupId: payload.group_id,
          groupName: payload.group_name,
        },
      });
    },
  });
  sock.connect();
  useFlink.setState({ mailbox: sock });
}

async function joinSession(sid: string, mode: CommMode, peerLabel: string) {
  const prev = useFlink.getState().session;
  prev?.close();
  let stream: MediaStream | undefined;
  try {
    stream = await mediaFor(mode);
  } catch {
    if (mode === "voice" || mode === "video") {
      toast.error("Camera or microphone was blocked");
      return;
    }
  }
  const session = new FlinkSession(sid, useFlink.getState().profile?.accessToken, mode, {
    onStatus: (text) => useFlink.setState({ callStatus: text }),
    onConnected: async () => {
      const number = /^\d{6}$/.test(peerLabel) ? peerLabel : undefined;
      if (number) {
        await useFlink.getState().upsertContact(number);
        const thread: Thread = {
          id: threadIdFor(number),
          kind: "direct",
          title: number,
          peerNumber: number,
          lastText: "Connected",
          lastTs: Date.now(),
        };
        await flinkStorage.putThread(thread);
        const messages = await flinkStorage.getMessages(thread.id);
        useFlink.setState((s) => ({
          threads: [thread, ...s.threads.filter((t) => t.id !== thread.id)],
          activeThread: s.activeThread ?? thread,
          messages: s.activeThread ? s.messages : messages,
          view: mode === "voice" || mode === "video" ? s.view : "chat",
        }));
      }
    },
    onChat: async (from, data) => {
      const number = /^\d{6}$/.test(from) ? from : peerLabel;
      const tid = threadIdFor(number);
      
      // Handle receipts
      if (data.kind === "receipt" && data.messageId && data.status) {
        if (data.status === "delivered") {
          await useFlink.getState().markMessageDelivered(data.messageId);
        } else if (data.status === "read") {
          await useFlink.getState().markMessageRead(data.messageId);
        }
        return;
      }
      
      // Handle reactions
      if (data.kind === "reaction" && data.emoji && data.messageId) {
        useFlink.setState((s) => ({
          messages: s.messages.map((m): ChatMessage => {
            if (m.id !== data.messageId) return m;
            const reactions = m.reactions ?? {};
            const emoji = data.emoji as string;
            const existing = reactions[emoji];
            return {
              ...m,
              reactions: {
                ...reactions,
                [emoji]: {
                  emoji,
                  count: existing ? existing.count + 1 : 1,
                  users: existing ? [...existing.users, from] : [from],
                },
              },
            };
          }),
        }));
        return;
      }
      
      // Handle screen sharing start/stop
      if (data.kind === "screen_start") {
        useFlink.setState({ isScreenSharing: true });
        return;
      }
      if (data.kind === "screen_stop") {
        useFlink.setState({ isScreenSharing: false });
        return;
      }
      if (data.kind === "participant_info") {
        useFlink.getState().updateParticipant(from, { name: data.displayName as string, joinedAt: Date.now() });
        return;
      }
      
      // Handle online status updates
      if (data.kind === "peer_online") {
        const sessionActive = data.sessionActive as boolean | undefined;
        const inCall = data.inCall as boolean | undefined;
        useFlink.getState().updatePeerStatus(from, true, sessionActive, inCall);
        return;
      }
      if (data.kind === "peer_offline") {
        useFlink.getState().updatePeerStatus(from, false, false, false);
        return;
      }
      
      // Handle regular messages
      const msg: ChatMessage = {
        id: data.id,
        threadId: tid,
        from,
        kind: data.kind === "image" ? "image" : data.kind === "voice" ? "voice" : data.kind === "video" ? "video" : data.kind === "gif" ? "gif" : data.kind === "file" ? "file" : "text",
        text: data.text,
        caption: data.caption,
        imageUrl: data.image,
        audioUrl: data.audio,
        videoUrl: data.video,
        fileUrl: data.file,
        fileName: data.fileName,
        ts: data.ts,
        mine: false,
        status: "delivered" as const,
        duration: data.duration,
      };
      await flinkStorage.putMessage(msg);
      const thread: Thread = {
        id: tid,
        kind: "direct",
        title: number,
        peerNumber: number,
        lastText: data.caption || data.text || (data.kind === "image" ? "Photo" : data.kind === "voice" ? "Voice note" : data.kind === "video" ? "Video" : data.kind === "gif" ? "GIF" : data.kind === "file" ? data.fileName || "File" : ""),
        lastTs: data.ts,
      };
      await flinkStorage.putThread(thread);
      useFlink.setState((s) => ({
        threads: [thread, ...s.threads.filter((t) => t.id !== tid)],
        messages: s.activeThread?.id === tid ? [...s.messages, msg] : s.messages,
      }));
      // Auto-mark as delivered when received
      if (data.id) {
        void useFlink.getState().markMessageDelivered(data.id);
      }
    },
    onPeerMedia: (id, mediaStream) => {
      useFlink.setState((s) => ({
        remoteMedia: [...s.remoteMedia.filter((m) => m.id !== id), { id, stream: mediaStream }],
        roomParticipants: new Map(s.roomParticipants).set(id, {
          flinkNumber: id,
          joinedAt: Date.now(),
          videoOn: true,
          audioOn: true,
          screenSharing: false,
        }),
      }));
    },
    onPeerLeft: (id, flinkNumber?: string) => {
      useFlink.setState((s) => {
        const participants = new Map(s.roomParticipants);
        participants.delete(flinkNumber ?? id);
        return { remoteMedia: s.remoteMedia.filter((m) => m.id !== id), roomParticipants: participants };
      });
      if (flinkNumber) {
        useFlink.getState().updatePeerStatus(flinkNumber, false, false, false);
      }
    },
    onPeerOnline: (flinkNumber: string, online: boolean, sessionActive?: boolean, inCall?: boolean) => {
      useFlink.getState().updatePeerStatus(flinkNumber, online, sessionActive, inCall);
    },
    onMessageDelivered: (messageId: string) => {
      void useFlink.getState().markMessageDelivered(messageId);
    },
    onMessageRead: (messageId: string) => {
      void useFlink.getState().markMessageRead(messageId);
    },
    onScreenShare: (peerId: string, sharing: boolean) => {
      useFlink.setState((s) => ({
        roomParticipants: new Map(s.roomParticipants).set(peerId, {
          flinkNumber: peerId,
          joinedAt: Date.now(),
          videoOn: true,
          audioOn: true,
          screenSharing: sharing,
        } as RoomParticipant),
      }));
    },
    onDeclined: () => {
      toast.message("They declined");
      useFlink.getState().hangup();
    },
  });
  await session.start(stream);
  useFlink.setState({
    session,
    localCameraStream: stream ?? null,
    outgoing: mode === "voice" || mode === "video" ? { to: peerLabel, mode, sessionId: sid } : useFlink.getState().outgoing,
    view: mode === "chat" || mode === "ping" ? "chat" : useFlink.getState().view,
  });
  if (mode === "chat" || mode === "ping") {
    const number = /^\d{6}$/.test(peerLabel) ? peerLabel : undefined;
    if (number) {
      const thread: Thread = {
        id: threadIdFor(number),
        kind: "direct",
        title: number,
        peerNumber: number,
        lastText: "Waiting…",
        lastTs: Date.now(),
      };
      await flinkStorage.putThread(thread);
      useFlink.setState((s) => ({
        activeThread: thread,
        threads: [thread, ...s.threads.filter((t) => t.id !== thread.id)],
        messages: [],
        view: "chat",
      }));
    }
  }
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

if (typeof window !== "undefined") {
  navigator.serviceWorker?.addEventListener("message", (event) => {
    const data = event.data as {
      type?: string;
      action?: "answer" | "decline";
      payload?: IncomingRequest & { session_id?: string; from?: string; mode?: CommMode };
    };
    if (data?.type !== "flink-push" && data?.type !== "flink-push-action") return;
    const payload = data.payload;
    if (!payload?.from) return;
    useFlink.setState({
      incoming: {
        from: payload.from,
        mode: payload.mode ?? "ping",
        sessionId: payload.sessionId ?? payload.session_id ?? "",
        groupId: payload.groupId,
        groupName: payload.groupName,
      },
    });
    if (data.action === "decline") useFlink.getState().declineIncoming();
    else startRingtone();
  });
}
