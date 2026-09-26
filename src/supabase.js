import { createClient } from "@supabase/supabase-js";
import { db } from "./db";

// La anon key es pública por diseño (viaja en el bundle); la protección real es RLS.
const SUPABASE_URL      = "https://rtpqdivjgrykwwbnsksw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0cHFkaXZqZ3J5a3d3Ym5za3N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNDkyNTEsImV4cCI6MjEwNTkyNTI1MX0.N5K0XIg2vMJYJm24wCxTcSWe7APBgjB00HIdlT4GXSU";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── AUTH ────────────────────────────────────────────────────
export async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

// El backend necesita la zona horaria para mandar push con la app cerrada.
export async function syncTimezone(userId) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await supabase.from("settings").upsert({ user_id: userId, timezone });
}

// ─── BLOQUES ─────────────────────────────────────────────────
export async function fetchBlocks() {
  const { data, error } = await supabase
    .from("weekly_blocks")
    .select("*")
    .order("day_of_week")
    .order("start_time");
  if (error) throw error;
  return data;
}

// Crea el mismo bloque en varios días de una vez (ej. Trabajo lun-vie).
export async function createBlocks(block, days) {
  const rows = days.map(day_of_week => ({ ...block, day_of_week }));
  const { data, error } = await supabase.from("weekly_blocks").insert(rows).select();
  if (error) throw error;
  return data;
}

export async function updateBlock(id, changes) {
  const { data, error } = await supabase.from("weekly_blocks").update(changes).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteBlock(id) {
  const { error } = await supabase.from("weekly_blocks").delete().eq("id", id);
  if (error) throw error;
}

// Traduce errores de Postgres a algo mostrable.
export function blockErrorMessage(error) {
  if (error?.code === "23P01") return "Se superpone con otro bloque de ese día.";
  if (error?.code === "23514") return "El horario de fin tiene que ser posterior al de inicio.";
  return error?.message || "No se pudo guardar.";
}

// ─── MIGRACIÓN DESDE INDEXEDDB ───────────────────────────────
// Solo tareas (type "task") con fecha. Los adjuntos se ignoran.
const CTX_TO_BLOCK_TYPE = { work: "trabajo", study: "estudio" };

export async function localTasksToMigrate() {
  const items = await db.getItems();
  return items.filter(i => i.type === "task" && i.deadline && i.text?.trim());
}

export async function migrateLocalTasks() {
  const items = await localTasksToMigrate();
  if (!items.length) return 0;
  const rows = items.map(i => ({
    legacy_id:     i.id,
    text:          i.text.trim(),
    assigned_date: i.deadline,
    prio:          i.prio || "mid",
    block_type:    CTX_TO_BLOCK_TYPE[i.ctx] || null,
    done:          !!i.done,
    completed_at:  i.done ? (i.completedAt || new Date().toISOString()) : null,
    created_at:    i.ts || new Date().toISOString(),
  }));
  // Idempotente: si ya se migró, unique (user_id, legacy_id) lo saltea.
  const { error } = await supabase
    .from("tasks")
    .upsert(rows, { onConflict: "user_id,legacy_id", ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}
