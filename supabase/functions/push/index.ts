// Edge Function "push": manda notificaciones Web Push.
//
// Acciones (POST JSON { action }):
//   public-key  → devuelve la clave pública VAPID (la genera la primera vez).
//   send-due    → manda los avisos de bloques que empezaron (la llama pg_cron cada minuto).
//   test        → manda un aviso de prueba al usuario del JWT.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Las claves se generan acá y viven solo en app_secrets (sin acceso desde el cliente).
async function loadVapid(): Promise<string> {
  const read = async () => {
    const { data, error } = await admin.from("app_secrets").select("key, value").in("key", ["vapid_public", "vapid_private"]);
    if (error) throw error;
    const get = (k: string) => data.find((r) => r.key === k)?.value;
    return { pub: get("vapid_public"), priv: get("vapid_private") };
  };
  let { pub, priv } = await read();
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    const { error } = await admin.from("app_secrets").upsert(
      [{ key: "vapid_public", value: keys.publicKey }, { key: "vapid_private", value: keys.privateKey }],
      { onConflict: "key", ignoreDuplicates: true },
    );
    if (error) throw error;
    ({ pub, priv } = await read());  // si otra instancia ganó la carrera, usamos las suyas
  }
  webpush.setVapidDetails("https://daily-roan.vercel.app", pub!, priv!);
  return pub!;
}

type Payload = { title: string; body: string; tag: string; url?: string };

async function sendToUser(userId: string, payload: Payload): Promise<number> {
  const { data: subs, error } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);
  if (error) throw error;
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ url: "/", ...payload }),
        { TTL: 60 * 60 },
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410: el navegador dio de baja la suscripción.
      if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", sub.id);
      else console.error("push failed", status, err);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { action } = await req.json().catch(() => ({}));
    const publicKey = await loadVapid();

    if (action === "public-key") return json({ publicKey });

    if (action === "send-due") {
      const { data, error } = await admin.rpc("due_block_notifications");
      if (error) throw error;
      let sent = 0;
      for (const n of data) sent += await sendToUser(n.user_id, { title: n.title, body: n.body, tag: n.key });
      return json({ due: data.length, sent });
    }

    if (action === "test") {
      const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return json({ error: "No autenticado" }, 401);
      const sent = await sendToUser(user.id, { title: "🔔 Daily", body: "Las notificaciones funcionan.", tag: "test" });
      return json({ sent });
    }

    return json({ error: "Acción desconocida" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: String((err as Error).message ?? err) }, 500);
  }
});
