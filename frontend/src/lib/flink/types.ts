export type CommMode = "chat" | "ping" | "voice" | "video" | "screen";

export type FlinkProfile = {
  flinkNumber: string;
  deviceId: string;
  simId: string;
  accessToken: string;
  password?: string;
  createdAt: number;
  avatarDataUrl?: string;
};

export type FlinkSimFile = {
  kind: "flink-sim";
  version: 1;
  payload: Record<string, unknown>;
  signature: string;
  algorithm: string;
  public_key?: string;
  password?: string;
  deviceId?: string;
  simId?: string;
};

export type Contact = {
  flinkNumber: string;
  name: string;
  lastSeen: number;
  online?: boolean;
  lastOnline?: number;
};

export type Reaction = {
  emoji: string;
  count: number;
  users: string[];
};

export type ChatMessage = {
  id: string;
  threadId: string;
  from: string;
  kind: "text" | "image" | "system" | "voice" | "video" | "gif" | "file";
  text?: string;
  caption?: string;
  imageUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  fileUrl?: string;
  fileName?: string;
  ts: number;
  mine: boolean;
  status?: "pending" | "sent" | "delivered" | "read";
  duration?: number;
  reactions?: Record<string, Reaction>;
  replyTo?: { id: string; from: string; preview: string };
};

export type Thread = {
  id: string;
  kind: "direct" | "group" | "room";
  title: string;
  peerNumber?: string;
  groupId?: string;
  lastText: string;
  lastTs: number;
  sessionActive?: boolean;
  sessionId?: string;
  unreadCount?: number;
};

export type CallLog = {
  id: string;
  peer: string;
  mode: CommMode;
  direction: "in" | "out";
  status: "calling" | "ringing" | "connected" | "ended" | "missed" | "declined";
  ts: number;
  durationSec?: number;
};

export type RoomLink = {
  id: string;
  title: string;
  mode: CommMode;
  url: string;
  hostNumber?: string;
  createdAt: number;
  lastOpenedAt: number;
};

export type PendingMessage = {
  id: string;
  threadId: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
};

export type FlinkGroup = {
  group_id: string;
  name: string;
  owner: string;
  members: string[];
  created_at: string;
  updated_at: string;
};

export type IncomingRequest = {
  from: string;
  mode: CommMode;
  sessionId: string;
  groupId?: string;
  groupName?: string;
  roomTitle?: string;
};

export type AppView =
  | "home"
  | "dial"
  | "history"
  | "calls"
  | "chat"
  | "groups"
  | "rooms"
  | "you";

export type SignalEvent = {
  type: string;
  from?: string;
  payload?: unknown;
  peer?: { peer_id: string; flink_number?: string | null };
  peer_id?: string;
  peers?: Array<{ peer_id: string; flink_number?: string | null }>;
  protocol?: number;
  session_id?: string;
};

export type PeerStatus = {
  flinkNumber: string;
  online: boolean;
  lastSeen: number;
  sessionActive: boolean;
  inCall?: boolean;
};

export type RoomParticipant = {
  flinkNumber: string;
  name?: string;
  joinedAt: number;
  videoOn: boolean;
  audioOn: boolean;
  screenSharing: boolean;
};
