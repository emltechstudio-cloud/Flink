import { FLINK_WS_URL } from "./config";
import type { SignalEvent } from "./types";

export type SignalingHandlers = {
  onEvent: (event: SignalEvent) => void;
  onOpen?: (peerId: string) => void;
  onClose?: () => void;
};

export class SignalingSocket {
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
    this.closed = false;
    this.open();
  }

  private open() {
    if (this.closed) return;
    const tokenQ = this.token ? `?token=${encodeURIComponent(this.token)}` : "";
    const url = `${FLINK_WS_URL}/flink/ws/${encodeURIComponent(this.sessionId)}${tokenQ}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      for (const message of this.queue.splice(0)) {
        try {
          ws.send(message);
        } catch {
          this.queue.unshift(message);
          break;
        }
      }
    };
    ws.onmessage = (ev) => {
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
      this.handlers.onClose?.();
      if (this.closed) return;
      const wait = Math.min(8000, 600 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.open(), wait);
    };
    ws.onerror = () => {
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
    this.ws.send(message);
    return true;
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
