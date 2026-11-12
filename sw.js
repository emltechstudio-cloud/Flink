const CACHE = "flink-static-v6";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
const scopeUrl = new URL(self.registration.scope);
const shellUrls = SHELL.map((path) => new URL(path, scopeUrl).toString());
const callTimers = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(shellUrls);
    const index = await cache.match(shellUrls[1]);
    if (index) {
      const html = await index.text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^\"]+)"/g)]
        .map((match) => new URL(match[1], scopeUrl).toString());
      if (assets.length) await cache.addAll(assets);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key === "flink-v1" || (key.startsWith("flink-static-") && key !== CACHE)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(scopeUrl.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE).then((cache) => cache.put(shellUrls[1], response.clone()));
      return response;
    }).catch(async () => (await caches.match(shellUrls[1])) || (await caches.match(shellUrls[0]))));
    return;
  }

  if (url.pathname.includes("/assets/")) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const from = data.from || "Someone";
  const isGroup = data.type === "flink_group_request";
  const mode = data.mode || "ping";
  const isCall = mode === "voice" || mode === "video";
  const notification = {
    body: isCall ? "Incoming Flink call" : "You have a new Flink message",
    icon: new URL("./icon.svg", scopeUrl).toString(),
    badge: new URL("./icon.svg", scopeUrl).toString(),
    data,
    tag: data.session_id || "flink",
    requireInteraction: true,
    vibrate: [250, 100, 250, 100, 500],
    actions: isCall ? [
      { action: "answer", title: "Answer" },
      { action: "decline", title: "Decline" },
    ] : [],
  };
  event.waitUntil(self.registration.showNotification("Flink", notification).then(() => {
    if (isCall && data.session_id && !callTimers.has(data.session_id)) {
      const refresh = setInterval(() => self.registration.showNotification("Flink", notification), 2000);
      callTimers.set(data.session_id, refresh);
    }
  }).then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true })).then((clients) => {
    clients.forEach((client) => client.postMessage({ type: "flink-push", payload: data }));
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const payload = event.notification.data || {};
  if (payload.session_id && callTimers.has(payload.session_id)) {
    clearInterval(callTimers.get(payload.session_id));
    callTimers.delete(payload.session_id);
  }
  const action = event.action || "answer";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) await client.focus();
      client.postMessage({ type: "flink-push-action", action, payload });
      return;
    }
    const client = await self.clients.openWindow(scopeUrl.toString());
    client?.postMessage({ type: "flink-push-action", action, payload });
  })());
});

self.addEventListener("notificationclose", (event) => {
  const sessionId = event.notification.data?.session_id;
  if (sessionId && callTimers.has(sessionId)) {
    clearInterval(callTimers.get(sessionId));
    callTimers.delete(sessionId);
  }
});
