const CACHE = "miinbox-v1";
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

// Push notifications
self.addEventListener("push", e => {
  const data = e.data?.json() || { title: "Mi Inbox", body: "Tenés tareas pendientes" };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "miinbox",
      renotify: true,
      data: { url: "/" }
    })
  );
});

// Notification click
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || "/"));
});

// Background sync for scheduled notifications
self.addEventListener("message", e => {
  if (e.data?.type === "SCHEDULE_CHECK") {
    checkDeadlines(e.data.tasks);
  }
});

function checkDeadlines(tasks) {
  if (!tasks?.length) return;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  tasks.forEach(t => {
    if (!t.deadline || t.done) return;
    if (t.deadline === todayStr && t.time) {
      const [h, m] = t.time.split(":").map(Number);
      const taskTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      const diff = taskTime - now;
      if (diff > 0 && diff <= 30 * 60 * 1000) {
        self.registration.showNotification("⏰ Tarea próxima", {
          body: `"${t.text}" vence a las ${t.time}`,
          icon: "/icon-192.png",
          tag: `task-${t.id}`,
        });
      }
    }
  });
}
