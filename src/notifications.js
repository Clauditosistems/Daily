// Notificaciones push reales (llegan con la app cerrada). Las manda la Edge Function "push".
import { supabase } from "./supabase";

export function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  const register = () => navigator.serviceWorker.register("/sw.js").catch(console.error);
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// iPhone/iPad solo permite push si la app está instalada en la pantalla de inicio.
export function needsInstallForPush() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;
  return ios && !standalone;
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// "unsupported" | "install" | "denied" | "on" | "off"
export async function pushStatus() {
  if (needsInstallForPush()) return "install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return (await currentSubscription()) ? "on" : "off";
}

function base64UrlToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function invokePush(action) {
  const { data, error } = await supabase.functions.invoke("push", { body: { action } });
  if (error) throw error;
  return data;
}

export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("No diste permiso para notificaciones.");
  const { publicKey } = await invokePush("public-key");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ||
    await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(publicKey) });
  const { endpoint, keys } = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions")
    .upsert({ endpoint, p256dh: keys.p256dh, auth: keys.auth }, { onConflict: "endpoint" });
  if (error) throw error;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe();
}

export async function sendTestPush() {
  const { sent } = await invokePush("test");
  if (!sent) throw new Error("No hay dispositivos suscriptos.");
}
