// Supabase falso, en memoria, SOLO para probar la interfaz en desarrollo:
//   REACT_APP_MOCK=1 npm start
// En el build de producción no se incluye (supabase.js solo lo carga con esa variable).
// Imita lo que la app usa: consultas encadenadas, algunas funciones (rpc) y los triggers de
// tareas/subtareas. Los datos son de ejemplo, nunca los reales.

const USER = { id: "00000000-0000-0000-0000-000000000001", email: "prueba@ejemplo.com" };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(16).slice(2)}`);
const nowIso = () => new Date().toISOString();
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return ymd(new Date(y, m - 1, d + n)); };
const dow = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };
const today = () => ymd(new Date());

// ─── Datos de ejemplo ────────────────────────────────────────
function seed() {
  const t = today();
  const base = { user_id: USER.id, created_at: nowIso(), updated_at: nowIso() };
  // ?mock=bloque → hoy hay un bloque de trabajo en curso; ?mock=cierre → hoy ya empezó el ocio.
  // Horarios relativos a la hora actual, para probar sin depender del reloj.
  const scenario = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("mock") : null;
  const hm = min => { const m = Math.max(0, Math.min(23 * 60 + 59, min)); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`; };
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const plan = scenario === "bloque"
    ? [["entreno", nowMin - 180, nowMin - 120], ["trabajo", nowMin - 60, nowMin + 90], ["estudio", nowMin + 100, nowMin + 160], ["ocio", nowMin + 170, nowMin + 230]]
    : scenario === "cierre"
      ? [["entreno", nowMin - 300, nowMin - 240], ["trabajo", nowMin - 230, nowMin - 120], ["estudio", nowMin - 110, nowMin - 40], ["ocio", nowMin - 30, nowMin + 120]]
      : [["entreno", 360, 480], ["trabajo", 540, 780], ["estudio", 840, 1080], ["ocio", 1140, 1320]];
  const blocks = [];
  for (let d = 0; d < 7; d++) {
    for (const [type, s, e] of plan)
      blocks.push({ ...base, id: uuid(), day_of_week: d, start_time: hm(s), end_time: hm(e), block_type: type, label: null, floating: false });
  }
  const feria = { ...base, id: uuid(), text: "Ir a la feria", block_type: "trabajo", days_of_week: [dow(t)], prio: "mid", active: true, generated_until: addDays(t, 7), scheduled_time: "09:30:00" };
  const task = (o) => ({ ...base, id: uuid(), block_type: null, block_id: null, done: false, completed_at: null, rollover_count: 0, routine_id: null,
    prio: "mid", legacy_id: null, scheduled_time: null, detail: null, outcome: null, detail_moved_at: null, assigned_date: t, ...o });
  const tasks = [
    task({ text: "Ir a la feria", routine_id: feria.id, block_type: "trabajo", detail: "Comprar remeras rojas\nY preguntar por las bolsas grandes", scheduled_time: "09:30:00" }),
    task({ text: "Preparar el envío de la semana", block_type: "trabajo", prio: "high" }),
    task({ text: "Leer el capítulo 4 y hacer el resumen de las ideas principales para la clase del jueves, con ejemplos propios", block_type: "estudio" }),
    task({ text: "Correr 5 km", block_type: "entreno", done: true, completed_at: nowIso() }),
    task({ text: "Llamar al banco", rollover_count: 2 }),
    task({ text: "Tomar creatina", routine_id: feria.id, assigned_date: t, block_type: "entreno", id: uuid() }),
  ];
  tasks[5].routine_id = null;  // (tarea suelta de entreno sin hacer, para el cierre)
  const subs = [
    { text: "Lista de productos", done: true }, { text: "Etiquetas", done: false }, { text: "Llevar al correo", done: false },
  ].map((s, i) => ({ ...base, id: uuid(), task_id: tasks[1].id, position: i, completed_at: s.done ? nowIso() : null, ...s }));
  return {
    settings: [{ user_id: USER.id, timezone: "America/Buenos_Aires", updated_at: nowIso(), notify_blocks: true, notify_tasks: true, notify_weekly: true,
      notify_birthdays: true, birthday_day_before: false, morning_time: "08:00:00", notify_midblock: true, notify_ocio: true, notify_dayclose: true,
      notify_plans: true, dayclose_fallback_time: "19:00:00" }],
    weekly_blocks: blocks, block_overrides: [], day_overrides: [], block_checkins: [],
    routines: [feria], tasks, subtasks: subs, events: [],
    notes: [
      { ...base, id: uuid(), kind: "note", text: "Una nota larga\ncon varias líneas\n\ny un párrafo aparte.", note_date: null, remind_time: null, archived: false, legacy_id: null },
      { ...base, id: uuid(), kind: "plan", text: "Activar flex el lunes", note_date: addDays(t, 2), remind_time: null, archived: false, legacy_id: null },
    ],
    birthdays: [{ ...base, id: uuid(), name: "Yas", month: 12, day: 1, year: 1999 }],
    weekly_summaries: [], push_subscriptions: [], push_log: [],
  };
}

const db = seed();
if (typeof window !== "undefined") window.__mockDb = db;  // para inspeccionar desde la consola

// ─── Triggers (igual que en la base) ─────────────────────────
function normalizeTask(n) {
  if (n.done && !n.completed_at) n.completed_at = nowIso();
  if (!n.done) n.completed_at = null;
  if (n.done) n.outcome = null;
}
function normalizeSub(n) {
  if (n.done && !n.completed_at) n.completed_at = nowIso();
  if (!n.done) n.completed_at = null;
}
function syncTaskFromSubs(taskId) {
  const subs = db.subtasks.filter(s => s.task_id === taskId);
  const task = db.tasks.find(t => t.id === taskId);
  if (!subs.length || !task) return;
  const all = subs.every(s => s.done);
  if (all !== task.done) { task.done = all; normalizeTask(task); }
}
function afterWrite(table, before, after) {
  if (table === "subtasks") new Set([...before, ...after].map(r => r.task_id)).forEach(syncTaskFromSubs);
  if (table === "tasks") after.forEach((t, i) => {
    const b = before[i];
    if (b && !b.done && t.done) db.subtasks.filter(s => s.task_id === t.id && !s.done).forEach(s => { s.done = true; normalizeSub(s); });
  });
}

// ─── Consultas encadenadas ───────────────────────────────────
const DEFAULTS = {
  tasks: () => ({ id: uuid(), user_id: USER.id, done: false, completed_at: null, rollover_count: 0, routine_id: null, prio: "mid", block_type: null, block_id: null,
    legacy_id: null, scheduled_time: null, detail: null, outcome: null, detail_moved_at: null, created_at: nowIso(), updated_at: nowIso() }),
  subtasks: () => ({ id: uuid(), user_id: USER.id, done: false, completed_at: null, position: 0, created_at: nowIso(), updated_at: nowIso() }),
};
const defaults = table => (DEFAULTS[table] ? DEFAULTS[table]() : { id: uuid(), user_id: USER.id, created_at: nowIso(), updated_at: nowIso() });

class Query {
  constructor(table) { this.table = table; this.filters = []; this.orders = []; this.op = "select"; this.cols = "*"; this.wantSingle = null; this.rng = null; }
  select(cols = "*") { if (this.op === "select") this.cols = cols; this.returning = true; return this; }
  insert(rows) { this.op = "insert"; this.payload = rows; return this; }
  upsert(rows, opts = {}) { this.op = "upsert"; this.payload = rows; this.opts = opts; return this; }
  update(changes) { this.op = "update"; this.payload = changes; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c, v) { this.filters.push(r => r[c] === v); return this; }
  neq(c, v) { this.filters.push(r => r[c] !== v); return this; }
  is(c, v) { this.filters.push(r => (r[c] ?? null) === v); return this; }
  in(c, vs) { this.filters.push(r => vs.includes(r[c])); return this; }
  gte(c, v) { this.filters.push(r => r[c] >= v); return this; }
  lte(c, v) { this.filters.push(r => r[c] <= v); return this; }
  gt(c, v) { this.filters.push(r => r[c] > v); return this; }
  lt(c, v) { this.filters.push(r => r[c] < v); return this; }
  order(c, o = {}) { this.orders.push([c, o.ascending !== false]); return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  limit(n) { this.rng = [0, n - 1]; return this; }
  single() { this.wantSingle = "single"; return this; }
  maybeSingle() { this.wantSingle = "maybe"; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }

  match(r) { return this.filters.every(f => f(r)); }
  project(r) {
    const m = /(\w+)\(([^)]*)\)/.exec(this.cols);  // join simple: weekly_blocks(a, b)
    const out = { ...r };
    if (m && m[1] === "weekly_blocks") out.weekly_blocks = db.weekly_blocks.find(b => b.id === r.block_id) || null;
    return out;
  }
  run() {
    const rows = db[this.table];
    if (!rows) return { data: null, error: { code: "PGRST205", message: `tabla ${this.table} no existe (mock)` } };
    let data;
    if (this.op === "select") {
      data = rows.filter(r => this.match(r)).map(r => this.project(r));
    } else if (this.op === "insert" || this.op === "upsert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(p => ({ ...defaults(this.table), ...p }));
      data = [];
      for (const n of list) {
        if (this.table === "tasks" && n.routine_id && rows.some(r => r.routine_id === n.routine_id && r.assigned_date === n.assigned_date && r.id !== n.id)) {
          if (this.opts?.ignoreDuplicates) continue;
          return { data: null, error: { code: "23505", message: "duplicate (mock)" } };
        }
        const existing = rows.find(r => r.id === n.id);
        if (existing) { if (this.op === "upsert" && !this.opts?.ignoreDuplicates) Object.assign(existing, n); continue; }
        if (this.table === "tasks") normalizeTask(n);
        if (this.table === "subtasks") normalizeSub(n);
        rows.push(n); data.push(n);
      }
      afterWrite(this.table, [], data);
    } else if (this.op === "update") {
      const hit = rows.filter(r => this.match(r));
      const before = hit.map(r => ({ ...r }));
      hit.forEach(r => { Object.assign(r, this.payload, { updated_at: nowIso() }); if (this.table === "tasks") normalizeTask(r); if (this.table === "subtasks") normalizeSub(r); });
      afterWrite(this.table, before, hit);
      data = hit;
    } else if (this.op === "delete") {
      const hit = rows.filter(r => this.match(r));
      db[this.table] = rows.filter(r => !this.match(r));
      if (this.table === "tasks") db.subtasks = db.subtasks.filter(s => !hit.some(t => t.id === s.task_id));
      afterWrite(this.table, hit, []);
      data = hit;
    }
    for (const [c, asc] of [...this.orders].reverse()) data.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
    if (this.rng) data = data.slice(this.rng[0], this.rng[1] + 1);
    data = JSON.parse(JSON.stringify(data));
    if (this.wantSingle === "single") return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows (mock)" } };
    if (this.wantSingle === "maybe") return { data: data[0] || null, error: null };
    return { data: this.op === "select" || this.returning ? data : null, error: null };
  }
}

// ─── Funciones (rpc) ─────────────────────────────────────────
function blocksForDay(date) {
  if (db.day_overrides.some(o => o.override_date === date && o.is_atypical !== false)) return [];
  return db.weekly_blocks.filter(b => b.day_of_week === dow(date)).map(b => {
    const o = db.block_overrides.find(x => x.block_id === b.id && x.override_date === date);
    if (o?.cancelled) return null;
    return { block_id: b.id, block_type: b.block_type, label: b.label, floating: b.floating,
      start_time: o?.start_time || b.start_time, end_time: o?.end_time || b.end_time, overridden: !!o };
  }).filter(Boolean).sort((a, b) => a.start_time.localeCompare(b.start_time));
}

const RPC = {
  blocks_for_day: ({ p_date }) => blocksForDay(p_date),
  rollover_mine: () => null,
  reschedule_day: () => 0,
  my_week_stats: () => ({ done: 0, done_prev: 0, steps_done: 0, pending: 0, active_days: 0, atypical_days: 0, planned_minutes: 0, blocks_total: 0, blocks_done: 0,
    streak_weeks: 0, best_streak: 0, by_type: [], routines: [] }),
  month_overview: () => [],
  activity_by_day: () => [],
};

const session = { user: USER, access_token: "mock" };
export const mockSupabase = {
  from: table => new Query(table),
  rpc: async (name, args) => (RPC[name] ? { data: RPC[name](args || {}), error: null } : { data: null, error: { message: `rpc ${name} no simulado` } }),
  auth: {
    getSession: async () => ({ data: { session } }),
    getUser: async () => ({ data: { user: USER } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
    signInWithOtp: async () => ({ error: null }),
  },
};
