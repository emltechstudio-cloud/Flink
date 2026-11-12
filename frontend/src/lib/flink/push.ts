import { urlBase64ToUint8Array } from "@/lib/utils";
import { flinkApi } from "./api";

const notificationIntervals = new Map<string, ReturnType<typeof setInterval>>();
const pendingNotifications = new Set<string>();

function notificationIcon() {
  return new URL(`${import.meta.env.BASE_URL}icon.svg`, window.location.href).toString();
}

export async function registerFlinkPush(token: string, requestPermission = false) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return false;
  }
  try {
    let permission = Notification.permission;
    if (permission === "default" && requestPermission) permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return true;
    const { public_key } = await flinkApi.pushPublicKey();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    });
    const json = sub.toJSON();
    await flinkApi.registerPush(token, {
      endpoint: json.endpoint ?? sub.endpoint,
      keys: (json.keys as Record<string, string> | undefined) ?? {},
      expirationTime: json.expirationTime ?? null,
    });
    return true;
  } catch {
    return false;
  }
}

export function showPersistentNotification(title: string, body: string, tag: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }
  if (pendingNotifications.has(tag)) {
    return;
  }
  pendingNotifications.add(tag);
  navigator.serviceWorker.ready.then((reg) => {
    const options: NotificationOptions = {
      body,
      tag,
      data,
      icon: notificationIcon(),
    };
    reg.showNotification(title, options);
  });
  const interval = setInterval(() => {
    if (!pendingNotifications.has(tag)) {
      clearInterval(interval);
      notificationIntervals.delete(tag);
      return;
    }
    navigator.serviceWorker.ready.then((reg) => {
      const options: NotificationOptions = {
        body,
        tag,
        data,
        icon: notificationIcon(),
      };
      reg.showNotification(title, options);
    });
  }, 30000);
  notificationIntervals.set(tag, interval);
}

export function dismissPersistentNotification(tag: string) {
  pendingNotifications.delete(tag);
  const interval = notificationIntervals.get(tag);
  if (interval) clearInterval(interval);
  notificationIntervals.delete(tag);
}

export function notifyIncomingCall(from: string, mode: string) {
  showPersistentNotification(
    `Incoming ${mode === "voice" ? "Call" : "Video Call"} on Flink`,
    `This is a call from Inet. ${from} wants to connect with you`,
    `call-${from}-${Date.now()}`,
    { type: "call", from, mode, ts: Date.now() }
  );
}

export function notifyNewMessage(from: string, text: string) {
  showPersistentNotification(
    "New Flink message",
    `This is a message from Inet. ${from}: ${text.slice(0, 50)}${text.length > 50 ? "..." : ""}`,
    `msg-${from}-${Date.now()}`,
    { type: "message", from, text, ts: Date.now() }
  );
}
