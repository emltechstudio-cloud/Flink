import { getIceServers } from "./config";
import { SignalingSocket } from "./signaling";
import type { CommMode, SignalEvent } from "./types";

type PeerSlot = {
  id: string;
  flinkNumber?: string | null;
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pending: RTCIceCandidateInit[];
  transfers: Map<string, { total: number; received: string[]; receivedBytes: number; meta: ChatData; field: "image" | "audio" | "video" | "file"; timer: ReturnType<typeof setTimeout> }>;
  sendQueue: Promise<void>;
};

export type ChatData = {
  kind: string;
  text?: string;
  caption?: string;
  image?: string;
  audio?: string;
  video?: string;
  file?: string;
  fileName?: string;
  id: string;
  ts: number;
  messageId?: string;
  duration?: number;
  emoji?: string;
  status?: "pending" | "sent" | "delivered" | "read";
  sessionActive?: boolean;
  inCall?: boolean;
  displayName?: string;
  replyTo?: { id: string; from: string; preview: string };
  avatarDataUrl?: string;
  group_id?: string;
  group_name?: string;
};

export type SessionHandlers = {
  onStatus: (text: string) => void;
  onChat: (from: string, data: ChatData) => void;
  onPeerMedia: (peerId: string, stream: MediaStream) => void;
  onPeerLeft: (peerId: string, flinkNumber?: string) => void;
  onConnected: (peers: number) => void;
  onDeclined?: () => void;
  onPeerOnline?: (flinkNumber: string, online: boolean, sessionActive?: boolean, inCall?: boolean) => void;
  onMessageDelivered?: (messageId: string) => void;
  onMessageRead?: (messageId: string) => void;
  onScreenShare?: (peerId: string, sharing: boolean) => void;
  onTransferFailed?: (data: ChatData) => void;
};

export class FlinkSession {
  private signaling: SignalingSocket;
  private peers = new Map<string, PeerSlot>();
  private localStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] = [];
  private selfId = "";
  private reconnectAttempts = new Map<string, number>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  closed = false;
  private static readonly CHUNK_SIZE = 48_000;
  private static readonly MAX_TRANSFER_SIZE = 32 * 1024 * 1024;
  private static readonly MAX_TRANSFER_CHUNKS = Math.ceil(FlinkSession.MAX_TRANSFER_SIZE / FlinkSession.CHUNK_SIZE);
  private static readonly MAX_ACTIVE_TRANSFERS = 4;
  private static readonly MAX_BUFFERED_AMOUNT = 1_000_000;

  constructor(
    readonly sessionId: string,
    readonly token: string | undefined,
    readonly mode: CommMode,
    readonly handlers: SessionHandlers,
    readonly displayName?: string,
    readonly avatarDataUrl?: string,
  ) {
    this.signaling = new SignalingSocket(sessionId, token, {
      onEvent: (e) => void this.onSignal(e),
      onOpen: (id) => {
        this.selfId = id;
        this.handlers.onStatus("Waiting for them to join");
      },
    });
  }

  async start(stream?: MediaStream) {
    this.localStream = stream ?? null;
    this.iceServers = await getIceServers();
    this.signaling.connect();
  }

  attachLocal(stream: MediaStream) {
    const audioTracks = stream.getAudioTracks().length > 0 ? stream.getAudioTracks() : this.localStream?.getAudioTracks() ?? [];
    const videoTracks = stream.getVideoTracks();
    this.localStream = new MediaStream([...audioTracks, ...videoTracks]);
    for (const slot of this.peers.values()) {
      for (const track of this.localStream.getTracks()) {
        const existing = slot.pc.getSenders().find((s) => s.track?.kind === track.kind);
        if (existing) void existing.replaceTrack(track);
        else slot.pc.addTrack(track, this.localStream);
      }
    }
  }

  sendChat(data: ChatData): boolean {
    const raw = JSON.stringify({ v: 1, ...data });
    let delivered = false;
    for (const slot of this.peers.values()) {
      if (slot.channel?.readyState !== "open") continue;
      delivered = true;
      const field = ["image", "audio", "video", "file"].find((key) => typeof data[key as keyof ChatData] === "string") as "image" | "audio" | "video" | "file" | undefined;
      if (!field || raw.length <= FlinkSession.CHUNK_SIZE) {
        slot.channel.send(raw);
        continue;
      }
      const transferId = `${data.id}-${field}`;
      const value = String(data[field]);
      const total = Math.ceil(value.length / FlinkSession.CHUNK_SIZE);
      if (value.length > FlinkSession.MAX_TRANSFER_SIZE || total > FlinkSession.MAX_TRANSFER_CHUNKS) {
        delivered = false;
        this.handlers.onStatus("Message is too large to send");
        continue;
      }
      const meta = { ...data, [field]: undefined } as ChatData;
      slot.sendQueue = slot.sendQueue.then(async () => {
        try {
          const channel = slot.channel;
          if (this.closed || channel?.readyState !== "open") throw new Error("Data channel is unavailable");
          await this.waitForChannelCapacity(channel);
          channel.send(JSON.stringify({ v: 1, kind: "chunk_start", transferId, total, field, meta }));
          for (let index = 0; index < total; index += 1) {
            await this.waitForChannelCapacity(channel);
            if (this.closed || channel.readyState !== "open") throw new Error("Data channel closed during transfer");
            channel.send(JSON.stringify({ v: 1, kind: "chunk", transferId, index, data: value.slice(index * FlinkSession.CHUNK_SIZE, (index + 1) * FlinkSession.CHUNK_SIZE) }));
          }
        } catch (error) {
          console.warn("chunked message send failed", error);
          this.handlers.onStatus("Message transfer failed — try again");
          this.handlers.onTransferFailed?.(data);
        }
      });
    }
    return delivered;
  }

  mute(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  setVideo(on: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = on;
    });
  }

  decline() {
    this.signaling.send("session-decline", { reason: "declined" });
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.signaling.send("session-leave", {});
    this.signaling.close();
    for (const slot of this.peers.values()) {
      for (const transfer of slot.transfers.values()) clearTimeout(transfer.timer);
      slot.transfers.clear();
      try {
        slot.channel?.close();
      } catch {
        /* noop */
      }
      slot.pc.close();
    }
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();
    this.peers.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }

  get local() {
    return this.localStream;
  }

  get peerCount() {
    return this.peers.size;
  }

  private async onSignal(event: SignalEvent) {
    if (event.type === "ready") {
      this.selfId = event.peer_id ?? this.selfId;
      for (const p of event.peers ?? []) {
        if (p.peer_id) await this.ensurePeer(p.peer_id, p.flink_number);
      }
      return;
    }
    if (event.type === "peer-joined" && event.peer?.peer_id) {
      await this.ensurePeer(event.peer.peer_id, event.peer.flink_number);
      return;
    }
    if (event.type === "peer-left" && event.peer?.peer_id) {
      this.dropPeer(event.peer.peer_id);
      return;
    }
    if (event.type === "peer-online" && event.peer?.peer_id && event.peer.flink_number) {
      this.handlers.onPeerOnline?.(event.peer.flink_number, event.payload as boolean, undefined, undefined);
      return;
    }
    if (event.type === "peer-offline" && event.peer?.peer_id && event.peer.flink_number) {
      this.handlers.onPeerOnline?.(event.peer.flink_number, false, false, false);
      return;
    }
    if (event.type === "session-decline") {
      this.handlers.onDeclined?.();
      return;
    }
    if (!event.from) return;
    const slot = await this.ensurePeer(event.from);
    if (event.type === "offer") {
      await this.handleOffer(slot, event.payload as RTCSessionDescriptionInit);
    } else if (event.type === "answer") {
      await this.handleAnswer(slot, event.payload as RTCSessionDescriptionInit);
    } else if (event.type === "ice") {
      const cand = event.payload as RTCIceCandidateInit;
      if (slot.pc.remoteDescription) {
        try {
          await slot.pc.addIceCandidate(cand);
        } catch {
          /* glare */
        }
      } else {
        slot.pending.push(cand);
      }
    }
  }

  private async ensurePeer(id: string, flinkNumber?: string | null) {
    const existing = this.peers.get(id);
    if (existing) {
      if (flinkNumber) existing.flinkNumber = flinkNumber;
      return existing;
    }
    const polite = this.selfId > id;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const slot: PeerSlot = {
      id,
      flinkNumber,
      pc,
      makingOffer: false,
      ignoreOffer: false,
      pending: [],
      transfers: new Map(),
      sendQueue: Promise.resolve(),
    };
    this.peers.set(id, slot);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    }

    if (!polite) {
      const channel = pc.createDataChannel("flink", { ordered: true });
      this.bindChannel(slot, channel);
    }
    pc.ondatachannel = (ev) => this.bindChannel(slot, ev.channel);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.signaling.send("ice", ev.candidate.toJSON(), id);
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.handlers.onPeerMedia(id, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        this.reconnectAttempts.delete(id);
        const timer = this.reconnectTimers.get(id);
        if (timer) clearTimeout(timer);
        this.reconnectTimers.delete(id);
        this.handlers.onConnected(this.peers.size);
        this.handlers.onStatus("Connected");
      }
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        if (this.closed || this.reconnectTimers.has(id)) return;
        const attempts = this.reconnectAttempts.get(id) ?? 0;
        if (attempts >= 2) {
          this.handlers.onStatus("Connection lost — try again");
          this.dropPeer(id);
          return;
        }
        this.reconnectAttempts.set(id, attempts + 1);
        this.handlers.onStatus(`Reconnecting… (${attempts + 1}/2)`);
        const timer = setTimeout(async () => {
          this.reconnectTimers.delete(id);
          if (this.closed || pc.connectionState === "connected" || pc.connectionState === "closed") return;
          try {
            pc.restartIce();
            if (!polite && pc.signalingState === "stable") {
              slot.makingOffer = true;
              await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
              this.signaling.send("offer", pc.localDescription, id);
              slot.makingOffer = false;
            }
          } catch {
            /* the next connection-state event counts the failed attempt */
          }
        }, attempts === 0 ? 700 : 1800);
        this.reconnectTimers.set(id, timer);
      }
    };

    pc.onnegotiationneeded = async () => {
      if (polite) return;
      try {
        slot.makingOffer = true;
        await pc.setLocalDescription(await pc.createOffer());
        this.signaling.send("offer", pc.localDescription, id);
      } catch (err) {
        console.warn("offer failed", err);
      } finally {
        slot.makingOffer = false;
      }
    };

    // Kick an offer from the single impolite side if we already have a stream.
    if (!polite && this.localStream) {
      try {
        slot.makingOffer = true;
        await pc.setLocalDescription(await pc.createOffer());
        this.signaling.send("offer", pc.localDescription, id);
      } finally {
        slot.makingOffer = false;
      }
    }

    return slot;
  }

  private bindChannel(slot: PeerSlot, channel: RTCDataChannel) {
    slot.channel = channel;
    channel.onopen = () => {
      this.handlers.onConnected(this.peers.size);
      this.handlers.onStatus("Talking");
      if (this.displayName || this.avatarDataUrl) {
        channel.send(JSON.stringify({
          v: 1,
          kind: "participant_info",
          displayName: this.displayName,
          avatarDataUrl: this.avatarDataUrl,
          id: `participant-${Date.now()}`,
          ts: Date.now(),
        }));
      }
    };
    channel.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as ChatData & {
          transferId?: string;
          total?: number;
          index?: number;
          data?: string;
          field?: "image" | "audio" | "video" | "file";
          meta?: ChatData;
        };
        if (data.kind === "chunk_start" && typeof data.transferId === "string" && data.transferId.length > 0 && data.transferId.length <= 256 && Number.isSafeInteger(data.total) && data.total! > 0 && data.total! <= FlinkSession.MAX_TRANSFER_CHUNKS && ["image", "audio", "video", "file"].includes(data.field ?? "") && data.meta && typeof data.meta === "object") {
          const old = slot.transfers.get(data.transferId);
          if (old) clearTimeout(old.timer);
          if (!old && slot.transfers.size >= FlinkSession.MAX_ACTIVE_TRANSFERS) return;
          const timer = setTimeout(() => slot.transfers.delete(data.transferId!), 60_000);
          slot.transfers.set(data.transferId, {
            total: data.total!,
            received: new Array(data.total!),
            receivedBytes: 0,
            meta: data.meta,
            field: data.field!,
            timer,
          });
          return;
        }
        if (data.kind === "chunk" && data.transferId && typeof data.index === "number" && typeof data.data === "string") {
          const transfer = slot.transfers.get(data.transferId);
          if (!transfer || !Number.isSafeInteger(data.index) || data.index! < 0 || data.index! >= transfer.total || data.data.length > FlinkSession.CHUNK_SIZE) return;
          if (transfer.received[data.index] !== undefined) return;
          if (transfer.receivedBytes + data.data.length > FlinkSession.MAX_TRANSFER_SIZE) {
            clearTimeout(transfer.timer);
            slot.transfers.delete(data.transferId);
            return;
          }
          transfer.received[data.index] = data.data;
          transfer.receivedBytes += data.data.length;
          clearTimeout(transfer.timer);
          transfer.timer = setTimeout(() => slot.transfers.delete(data.transferId!), 60_000);
          // Array.prototype.every skips holes in sparse arrays; count explicit
          // chunks instead so a transfer is not completed after only chunk 0.
          if (transfer.received.filter((part) => typeof part === "string").length === transfer.total) {
            const complete = { ...transfer.meta, [transfer.field]: transfer.received.join("") };
            clearTimeout(transfer.timer);
            slot.transfers.delete(data.transferId);
            this.handlers.onChat(slot.flinkNumber || slot.id, complete);
          }
          return;
        }
        this.handlers.onChat(slot.flinkNumber || slot.id, data);
      } catch {
        /* ignore */
      }
    }
  }

  private waitForChannelCapacity(channel: RTCDataChannel): Promise<void> {
    if (channel.bufferedAmount <= FlinkSession.MAX_BUFFERED_AMOUNT) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        if (this.closed || channel.readyState !== "open") {
          reject(new Error("Data channel unavailable"));
          return;
        }
        if (Date.now() - startedAt >= 60_000) {
          reject(new Error("Data channel remained congested"));
          return;
        }
        if (channel.bufferedAmount <= 250_000) resolve();
        else setTimeout(check, 30);
      };
      check();
    });
  }

  private async handleOffer(slot: PeerSlot, desc: RTCSessionDescriptionInit) {
    const polite = this.selfId > slot.id;
    const collision = slot.makingOffer || slot.pc.signalingState !== "stable";
    slot.ignoreOffer = !polite && collision;
    if (slot.ignoreOffer) return;
    await slot.pc.setRemoteDescription(desc);
    for (const c of slot.pending) {
      try {
        await slot.pc.addIceCandidate(c);
      } catch {
        /* noop */
      }
    }
    slot.pending = [];
    await slot.pc.setLocalDescription(await slot.pc.createAnswer());
    this.signaling.send("answer", slot.pc.localDescription, slot.id);
  }

  private async handleAnswer(slot: PeerSlot, desc: RTCSessionDescriptionInit) {
    try {
      await slot.pc.setRemoteDescription(desc);
      for (const c of slot.pending) {
        try {
          await slot.pc.addIceCandidate(c);
        } catch {
          /* noop */
        }
      }
      slot.pending = [];
    } catch {
      /* glare */
    }
  }

  private dropPeer(id: string) {
    const slot = this.peers.get(id);
    if (!slot) return;
    for (const transfer of slot.transfers.values()) clearTimeout(transfer.timer);
    slot.transfers.clear();
    slot.pc.close();
    const timer = this.reconnectTimers.get(id);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(id);
    this.reconnectAttempts.delete(id);
    this.peers.delete(id);
    this.handlers.onPeerLeft(id, slot.flinkNumber ?? undefined);
  }

  sendReceipt(messageId: string, status: "delivered" | "read") {
    const raw = JSON.stringify({ v: 1, kind: "receipt", messageId, status, ts: Date.now() });
    for (const slot of this.peers.values()) {
      if (slot.channel?.readyState === "open") slot.channel.send(raw);
    }
  }

  sendOnlineStatus(online: boolean, sessionActive?: boolean, inCall?: boolean) {
    const raw = JSON.stringify({ v: 1, kind: "peer_online", online, sessionActive, inCall, ts: Date.now() });
    for (const slot of this.peers.values()) {
      if (slot.channel?.readyState === "open") slot.channel.send(raw);
    }
  }

  replaceStream(stream: MediaStream) {
    this.localStream = stream;
    for (const slot of this.peers.values()) {
      for (const track of stream.getTracks()) {
        const existing = slot.pc.getSenders().find((s) => s.track?.kind === track.kind);
        if (existing) void existing.replaceTrack(track);
        else slot.pc.addTrack(track, stream);
      }
    }
  }

  sendScreenShare(sharing: boolean) {
    const raw = JSON.stringify({ v: 1, kind: sharing ? "screen_start" : "screen_stop", ts: Date.now() });
    for (const slot of this.peers.values()) {
      if (slot.channel?.readyState === "open") slot.channel.send(raw);
    }
  }
}
