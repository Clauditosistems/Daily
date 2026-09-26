import { createClient } from "@supabase/supabase-js";
import { db } from "./db";
import { addDays, parseYmd } from "./ui";

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

// Bloques efectivos de una fecha (semana tipo + overrides + día atípico).
export async function fetchBlocksForDay(date) {
  const { data, error } = await supabase.rpc("blocks_for_day", { p_date: date });
  if (error) throw error;
  return data;
}

// ─── DÍAS ATÍPICOS Y CAMBIOS DE UN BLOQUE POR UN DÍA ─────────
export async function fetchDayOverride(date) {
  const { data, error } = await supabase.from("day_overrides").select("*").eq("override_date", date).maybeSingle();
  if (error) throw error;
  return data;
}

// Marca el día y reprograma sus tareas (ver reschedule_day). Devuelve cuántas se movieron.
export async function markAtypical(date, note) {
  const { error } = await supabase.from("day_overrides").insert({ override_date: date, note: note || null });
  if (error) throw error;
  const { data, error: e2 } = await supabase.rpc("reschedule_day", { p_date: date });
  if (e2) throw e2;
  return data;
}

export async function unmarkAtypical(id) {
  const { error } = await supabase.from("day_overrides").delete().eq("id", id);
  if (error) throw error;
}

export async function fetchCancelledBlocks(date) {
  const { data, error } = await supabase.from("block_overrides")
    .select("id, block_id, weekly_blocks(block_type, label, start_time, end_time)")
    .eq("override_date", date).eq("cancelled", true);
  if (error) throw error;
  return data;
}

// changes: { start_time, end_time } para mover el horario, o { cancelled: true }.
export async function setBlockOverride(blockId, date, changes) {
  const { error } = await supabase.from("block_overrides").upsert(
    { block_id: blockId, override_date: date, start_time: null, end_time: null, cancelled: false, ...changes },
    { onConflict: "block_id,override_date" });
  if (error) throw error;
}

export async function clearBlockOverride(blockId, date) {
  const { error } = await supabase.from("block_overrides").delete().eq("block_id", blockId).eq("override_date", date);
  if (error) throw error;
}

// Pasa las tareas pendientes de días anteriores (el cron hace lo mismo cada hora).
export async function rolloverMine() {
  const { error } = await supabase.rpc("rollover_mine");
  if (error) throw error;
}

// ─── TAREAS ──────────────────────────────────────────────────
export async function fetchTasksForDate(date) {
  const { data, error } = await supabase.from("tasks").select("*").eq("assigned_date", date).order("created_at");
  if (error) throw error;
  return data;
}

// Tareas pendientes por día para la tira semanal.
export async function fetchPendingCounts(from, to) {
  const { data, error } = await supabase.from("tasks").select("assigned_date")
    .eq("done", false).gte("assigned_date", from).lte("assigned_date", to);
  if (error) throw error;
  const counts = {};
  data.forEach(t => { counts[t.assigned_date] = (counts[t.assigned_date] || 0) + 1; });
  return counts;
}

export async function createTask(task) {
  const { data, error } = await supabase.from("tasks").insert(task).select().single();
  if (error) throw error;
  return data;
}

export async function updateTask(id, changes) {
  const { data, error } = await supabase.from("tasks").update(changes).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

// ─── RUTINAS ─────────────────────────────────────────────────
export async function fetchRoutines() {
  const { data, error } = await supabase.from("routines").select("*").order("created_at");
  if (error) throw error;
  return data;
}

export async function createRoutine(routine) {
  const { data, error } = await supabase.from("routines").insert(routine).select().single();
  if (error) throw error;
  return data;
}

// Los cambios también se aplican a las instancias pendientes de hoy en adelante.
export async function updateRoutine(id, changes, today) {
  // Se regenera desde hoy para que los días agregados tengan su instancia.
  const { data, error } = await supabase.from("routines")
    .update({ ...changes, generated_until: addDays(today, -1) }).eq("id", id).select().single();
  if (error) throw error;
  const { error: e2 } = await supabase.from("tasks")
    .update({ text: data.text, block_type: data.block_type, prio: data.prio, scheduled_time: data.scheduled_time })
    .eq("routine_id", id).eq("done", false).gte("assigned_date", today);
  if (e2) throw e2;
  // Días que dejaron de aplicar (o rutina pausada): se borran sus instancias futuras pendientes.
  const removed = [0, 1, 2, 3, 4, 5, 6].filter(d => !data.active || !data.days_of_week.includes(d));
  if (removed.length) await deleteFutureInstances(id, today, removed);
  return data;
}

export async function deleteRoutine(id, today) {
  await deleteFutureInstances(id, today);
  const { error } = await supabase.from("routines").delete().eq("id", id);
  if (error) throw error;
}

async function deleteFutureInstances(routineId, today, weekdays = null) {
  const { data, error } = await supabase.from("tasks").select("id, assigned_date")
    .eq("routine_id", routineId).eq("done", false).gte("assigned_date", today);
  if (error) throw error;
  const ids = data
    .filter(t => !weekdays || weekdays.includes(parseYmd(t.assigned_date).getDay()))
    .map(t => t.id);
  if (!ids.length) return;
  const { error: e2 } = await supabase.from("tasks").delete().in("id", ids);
  if (e2) throw e2;
}

// Crea las instancias de las rutinas activas desde hoy (o desde donde se quedó cada rutina)
// hasta la última fecha pedida. generated_until evita recrear instancias borradas a mano.
export async function ensureRoutineTasks(routines, dates, today) {
  const until = dates.reduce((a, b) => (a > b ? a : b));
  if (until < today) return;
  const rows = [], advanced = [];
  routines.filter(r => r.active).forEach(r => {
    let date = r.generated_until && r.generated_until >= today ? addDays(r.generated_until, 1) : today;
    if (date > until) return;
    for (; date <= until; date = addDays(date, 1)) {
      if (r.days_of_week.includes(parseYmd(date).getDay()))
        rows.push({ routine_id: r.id, assigned_date: date, text: r.text, block_type: r.block_type, prio: r.prio, scheduled_time: r.scheduled_time });
    }
    advanced.push(r);
  });
  if (rows.length) {
    const { error } = await supabase.from("tasks")
      .upsert(rows, { onConflict: "routine_id,assigned_date", ignoreDuplicates: true });
    if (error) throw error;
  }
  for (const r of advanced) {
    const { error } = await supabase.from("routines").update({ generated_until: until }).eq("id", r.id);
    if (error) throw error;
    r.generated_until = until;
  }
}

// ─── RESUMEN SEMANAL ─────────────────────────────────────────
// Stats en vivo de una semana (lunes a domingo).
export async function fetchWeekStats(weekStart) {
  const { data, error } = await supabase.rpc("my_week_stats", { p_week_start: weekStart });
  if (error) throw error;
  return data;
}

// Snapshot guardado el domingo a la noche, si existe.
export async function fetchSavedSummary(weekStart) {
  const { data, error } = await supabase.from("weekly_summaries").select("stats, created_at")
    .eq("week_start", weekStart).maybeSingle();
  if (error) throw error;
  return data;
}

// ─── CONFIGURACIÓN ───────────────────────────────────────────
export async function fetchSettings() {
  const { data, error } = await supabase.from("settings").select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateSettings(changes) {
  const { data, error } = await supabase.from("settings").update(changes)
    .eq("user_id", (await supabase.auth.getSession()).data.session.user.id).select().single();
  if (error) throw error;
  return data;
}

// ─── NOTAS E IDEAS ───────────────────────────────────────────
export async function fetchNotes(kind, archived = false) {
  const { data, error } = await supabase.from("notes").select("*")
    .eq("kind", kind).eq("archived", archived)
    .order("note_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchNotesForDate(date) {
  const { data, error } = await supabase.from("notes").select("*")
    .eq("note_date", date).eq("archived", false).order("remind_time", { nullsFirst: true });
  if (error) throw error;
  return data;
}

export async function createNote(note) {
  const { data, error } = await supabase.from("notes").insert(note).select().single();
  if (error) throw error;
  return data;
}

export async function updateNote(id, changes) {
  const { data, error } = await supabase.from("notes").update(changes).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteNote(id) {
  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) throw error;
}

// ─── CUMPLEAÑOS ──────────────────────────────────────────────
export async function fetchBirthdays() {
  const { data, error } = await supabase.from("birthdays").select("*").order("month").order("day");
  if (error) throw error;
  return data;
}

export async function saveBirthday(id, birthday) {
  const q = id
    ? supabase.from("birthdays").update(birthday).eq("id", id)
    : supabase.from("birthdays").insert(birthday);
  const { data, error } = await q.select().single();
  if (error) throw error;
  return data;
}

export async function deleteBirthday(id) {
  const { error } = await supabase.from("birthdays").delete().eq("id", id);
  if (error) throw error;
}

// Convierte una tarea suelta en la primera instancia de una rutina nueva.
export async function makeRoutineFromTask(task, days) {
  const routine = await createRoutine({
    text: task.text, block_type: task.block_type, prio: task.prio, scheduled_time: task.scheduled_time,
    days_of_week: [...days].sort((a, b) => a - b),
  });
  const updated = await updateTask(task.id, { routine_id: routine.id });
  return { routine, task: updated };
}

// ─── VISTAS AGREGADAS ────────────────────────────────────────
// Un registro por día: tipos de bloque, pendientes, hechas, notas, día atípico.
export async function fetchMonthOverview(from, to) {
  const { data, error } = await supabase.rpc("month_overview", { p_from: from, p_to: to });
  if (error) throw error;
  return data;
}

// Tareas completadas por día (fecha local) desde "from".
export async function fetchActivity(from) {
  const { data, error } = await supabase.rpc("activity_by_day", { p_from: from });
  if (error) throw error;
  return data;
}

// ─── "✓ ESTUVE" ──────────────────────────────────────────────
// ids de bloques marcados como "estuve" ese día.
export async function fetchCheckins(date) {
  const { data, error } = await supabase.from("block_checkins").select("block_id").eq("day", date);
  if (error) throw error;
  return data.map(r => r.block_id);
}

export async function setCheckin(blockId, date, on) {
  const { error } = on
    ? await supabase.from("block_checkins").upsert({ block_id: blockId, day: date }, { onConflict: "user_id,block_id,day", ignoreDuplicates: true })
    : await supabase.from("block_checkins").delete().eq("block_id", blockId).eq("day", date);
  if (error) throw error;
}

// Días atípicos desde "from" (para mostrarlos neutros en el mapa de actividad).
export async function fetchAtypicalDays(from) {
  const { data, error } = await supabase.from("day_overrides").select("override_date")
    .gte("override_date", from).eq("is_atypical", true);
  if (error) throw error;
  return data.map(r => r.override_date);
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

// Notas, ideas y planes viejos → notes. Los planes pasan como notas; los adjuntos se ignoran.
export async function localNotesToMigrate() {
  const items = await db.getItems();
  return items.filter(i => ["note", "idea", "plan"].includes(i.type) && i.text?.trim());
}

export async function migrateLocalNotes() {
  const items = await localNotesToMigrate();
  if (!items.length) return 0;
  const rows = items.map(i => {
    const kind = i.type === "idea" ? "idea" : "note";
    return {
      legacy_id:  i.id,
      kind,
      text:       i.text.trim(),
      note_date:  kind === "note" ? i.deadline || null : null,
      archived:   !!i.done,
      created_at: i.ts || new Date().toISOString(),
    };
  });
  const { error } = await supabase
    .from("notes")
    .upsert(rows, { onConflict: "user_id,legacy_id", ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}
