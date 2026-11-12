const DEFAULT_API = "https://emltechstudio-eml-core-api.hf.space";

export const FLINK_API_URL = (
  import.meta.env.VITE_FLINK_API_URL ?? DEFAULT_API
).replace(/\/$/, "");

export const FLINK_WS_URL = FLINK_API_URL.replace(/^http/, "ws");

const configuredTurn = import.meta.env.VITE_TURN_URL as string | undefined;
const configuredTurnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
const configuredTurnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
const PUBLIC_TURN_HOST = "staticauth.openrelay.metered.ca";
const PUBLIC_TURN_SECRET = "openrelayprojectsecret";

const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

async function publicTurnCredentials() {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") return null;
  const username = `${Math.floor(Date.now() / 1000) + 3600}:flink`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PUBLIC_TURN_SECRET),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return {
    urls: [
      `turn:${PUBLIC_TURN_HOST}:80?transport=udp`,
      `turn:${PUBLIC_TURN_HOST}:443?transport=udp`,
      `turns:${PUBLIC_TURN_HOST}:443?transport=tcp`,
    ],
    username,
    credential: btoa(binary),
  } satisfies RTCIceServer;
}

let iceServersPromise: Promise<RTCIceServer[]> | null = null;
export function getIceServers() {
  if (!iceServersPromise) {
    iceServersPromise = (async () => {
      const configured = configuredTurn
        ? [{
            urls: configuredTurn,
            ...(configuredTurnUsername ? { username: configuredTurnUsername } : {}),
            ...(configuredTurnCredential ? { credential: configuredTurnCredential } : {}),
          } satisfies RTCIceServer]
        : [];
      // Include a public relay as a fallback even when a deployment-specific TURN
      // server is configured; clients on restrictive networks may not reach it.
      const publicTurn = await publicTurnCredentials().catch(() => null);
      return [...STUN_SERVERS, ...configured, ...(publicTurn ? [publicTurn] : [])];
    })();
  }
  return iceServersPromise;
}

export const PROTOCOL = 2;
