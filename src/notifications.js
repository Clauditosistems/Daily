// Notificaciones locales — no requiere servidor

export async function requestPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(console.error);
  });
}

// Programa revisión de tareas cada 15 minutos
export function scheduleDeadlineCheck(tasks) {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    reg.active?.postMessage({ type: "SCHEDULE_CHECK", tasks });
  });
}

// Notificación inmediata (para testing o alertas manuales)
export function notify(title, body, tag = "miinbox") {
  if (Notification.permission !== "granted") return;
  new Notification(title, { body, icon: "/icon-192.png", tag });
}

// Revisa tareas que vencen hoy y notifica si hay permiso
export function checkAndNotifyToday(tasks) {
  if (Notification.permission !== "granted") return;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const dueToday = tasks.filter(t => !t.done && t.deadline === todayStr);
  if (dueToday.length > 0) {
    notify(
      `📅 ${dueToday.length} tarea${dueToday.length > 1 ? "s" : ""} para hoy`,
      dueToday.slice(0, 3).map(t => `• ${t.text}`).join("\n"),
      "daily-summary"
    );
  }
}
