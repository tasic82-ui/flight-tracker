const CACHE = "ft-v1";
const ASSETS = ["/", "/static/css/app.css", "/static/js/app.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if (e.request.url.includes("/api/")) return; // never cache API
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────────────────────
self.addEventListener("push", e => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); } catch { payload = { title: "Flight Update", body: e.data.text() }; }

  const options = {
    body:    payload.body,
    icon:    "/static/icons/icon-192.png",
    badge:   "/static/icons/icon-192.png",
    vibrate: [200, 100, 200],
    data:    payload.data || {},
    actions: [
      { action: "open",   title: "Otvori" },
      { action: "dismiss", title: "Zatvori" }
    ],
    requireInteraction: true
  };

  e.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  if (e.action === "dismiss") return;
  e.waitUntil(clients.openWindow("/"));
});
