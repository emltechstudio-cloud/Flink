import { FLINK_WS_URL } from "./config";
import type { SignalEvent } from "./types";

export type SignalingHandlers = {
  onEvent: (event: SignalEvent) => void;
  onOpen?: (peerId: string) => void;
  onClose?: () => void;
};

export class SignalingSocket {
  private static readonly MAX_RETRY_DELAY_MS = 30_000;
  private static readonly INITIAL_RETRY_DELAY_MS = 600;
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: string[] = [];
  peerId: string | null = null;

  constructor(
    readonly sessionId: string,
    readonly token: string | undefined,
    readonly handlers: SignalingHandlers,
  ) {}

  connect() {
    if (!this.closed && this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    this.closed = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.open();
  }

  private open() {
    if (this.closed || (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN))) return;
    const tokenQ = this.token ? `?token=${encodeURIComponent(this.token)}` : "";
    const url = `${FLINK_WS_URL}/flink/ws/${encodeURIComponent(this.sessionId)}${tokenQ}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws || this.closed) {
        ws.close();
        return;
      }
      this.retry = 0;
      while (this.queue.length && ws.readyState === WebSocket.OPEN) {
        try {
          // Remove only after send succeeds; a failed attempt and all following
          // messages remain queued in original order for the next connection.
          ws.send(this.queue[0]);
          this.queue.shift();
        } catch {
          break;
        }
      }
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || this.closed) return;
      try {
        const event = JSON.parse(String(ev.data)) as SignalEvent;
        if (event.type === "ready") {
          this.peerId = event.peer_id ?? null;
          this.handlers.onOpen?.(this.peerId ?? "");
        }
        this.handlers.onEvent(event);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.handlers.onClose?.();
      if (this.closed) return;
      const exponential = Math.min(SignalingSocket.MAX_RETRY_DELAY_MS,
        SignalingSocket.INITIAL_RETRY_DELAY_MS * 2 ** Math.min(this.retry++, 10));
      // Jitter prevents a group of clients from repeatedly reconnecting in lockstep.
      const wait = Math.round(exponential * (0.8 + Math.random() * 0.4));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.open();
      }, wait);
    };
    ws.onerror = () => {
      if (this.ws !== ws) return;
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }

  send(type: string, payload?: unknown, target?: string) {
    const message = JSON.stringify({ type, payload, target });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (!this.closed) this.queue.push(message);
      return false;
    }
    try {
      this.ws.send(message);
      return true;
    } catch {
      // Preserve the message if the transport fails during send.
      if (!this.closed) this.queue.push(message);
      try { this.ws.close(); } catch { /* noop */ }
      return false;
    }
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = null;
    this.queue = [];
  }
}

/** Briefly join someone's mailbox session and deliver a request. */
export function dropMailbox(targetNumber: string, payload: unknown, token?: string): Promise<void> {
  return new Promise((resolve) => {
    const session = `mb-${targetNumber}`;
    const tokenQ = token ? `?token=${encodeURIComponent(token)}` : "";
    const ws = new WebSocket(`${FLINK_WS_URL}/flink/ws/${session}${tokenQ}`);
    const done = () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      resolve();
    };
    const t = setTimeout(done, 2500);
    ws.onopen = () => {
      /* wait for ready */
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as SignalEvent;
        if (msg.type === "ready") {
          ws.send(JSON.stringify({ type: "flink_request", payload }));
          setTimeout(() => {
            clearTimeout(t);
            done();
          }, 250);
        }
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      clearTimeout(t);
      done();
    };
  });
}
