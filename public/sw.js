const CACHE = "daily-v2";
const ASSETS = ["/", "/index.html", "/static/js/main.chunk.js", "/static/js/bundle.js", "/manifest.json"];

// Install: cache assets
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Fetch: network first, fallback to cache
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// Push: el payload viene de la Edge Function "push" ({ title, body, tag, url }).
self.addEventListener("push", e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch { data = { body: e.data?.text() }; }
  e.waitUntil(
    self.registration.showNotification(data.title || "Daily", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "daily",
      renotify: true,
      data: { url: data.url || "/" },
    })
  );
});

// Tocar la notificación: enfoca la app si ya está abierta, si no la abre.
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const open = list.find(c => new URL(c.url).origin === self.location.origin);
      return open ? open.focus() : self.clients.openWindow(url);
    })
  );
});
