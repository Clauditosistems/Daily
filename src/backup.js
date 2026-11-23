// ─── BACKUP: EXPORTAR / IMPORTAR ─────────────────────────────
// Exportar baja a un JSON todo lo tuyo en Supabase + lo que haya quedado solo en este
// dispositivo (IndexedDB de la versión anterior, con adjuntos, y las preferencias locales).
// Importar SOLO AGREGA lo que falta: nunca borra ni modifica filas que ya existen.
import { supabase } from "./supabase";

export const BACKUP_FORMAT = 1;

// Tablas que se exportan, en orden de dependencias (padres primero).
// `restore: false` = se guardan pero no se reimportan (las escribe el servidor o son de un dispositivo).
// Las tablas nuevas (subtareas, eventos) se suman acá cuando existan; si una no existe todavía, se saltea.
const TABLES = [
  { name: "settings",           restore: true, key: "user_id" },
  { name: "weekly_blocks",      restore: true },
  { name: "routines",           restore: true },
  { name: "tasks",              restore: true },
  { name: "subtasks",           restore: true },
  { name: "events",             restore: true },
  { name: "block_overrides",    restore: true },
  { name: "day_overrides",      restore: true },
  { name: "block_checkins",     restore: true },
  { name: "notes",              restore: true },
  { name: "birthdays",          restore: true },
  { name: "weekly_summaries",   restore: false },
  { name: "push_subscriptions", restore: false },
  { name: "push_log",           restore: false },
];

const PAGE = 1000;
const LEGACY_DB = "miinbox";
const missingTable = err => err && (err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message || ""));

async function fetchAll(table, key) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select("*").order(key, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

// ─── Datos que viven solo en este dispositivo ────────────────
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Convierte adjuntos (Blob/File/ArrayBuffer) a texto para que entren en el JSON.
async function serialize(value) {
  if (value instanceof Blob) {
    return { __blob: await blobToDataURL(value), type: value.type, name: value.name || null, size: value.size };
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return { __blob: await blobToDataURL(new Blob([value])), type: "application/octet-stream", arrayBuffer: true };
  }
  if (Array.isArray(value)) return Promise.all(value.map(serialize));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await serialize(v);
    return out;
  }
  return value;
}

async function deserialize(value) {
  if (value && typeof value === "object" && typeof value.__blob === "string") {
    const blob = await (await fetch(value.__blob)).blob();
    if (value.arrayBuffer) return blob.arrayBuffer();
    return value.name ? new File([blob], value.name, { type: value.type }) : new Blob([blob], { type: value.type });
  }
  if (Array.isArray(value)) return Promise.all(value.map(deserialize));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await deserialize(v);
    return out;
  }
  return value;
}

// ¿Existe la base local de la versión anterior? (para no crearla al exportar en un dispositivo limpio)
async function legacyExists() {
  try {
    if (indexedDB.databases) return (await indexedDB.databases()).some(d => d.name === LEGACY_DB && d.version > 0);
  } catch {}
  return true;  // navegador sin databases(): se abre igual (en el peor caso queda una base vacía)
}

// Misma estructura que src/db.js.
function openLegacyDB() {
  return new Promise(resolve => {
    let req;
    try { req = indexedDB.open(LEGACY_DB); } catch { resolve(null); return; }
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("items"))   db.createObjectStore("items",   { keyPath: "id" });
      if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta"))    db.createObjectStore("meta",    { keyPath: "key" });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => resolve(null);
  });
}

function storeGetAll(db, store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readLocalData() {
  const local = { indexeddb: null, localStorage: {} };
  const db = (await legacyExists()) ? await openLegacyDB() : null;
  if (db) {
    try {
      const stores = {};
      for (const name of Array.from(db.objectStoreNames)) stores[name] = await serialize(await storeGetAll(db, name));
      local.indexeddb = { name: LEGACY_DB, stores };
    } finally { db.close(); }
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith("sb-")) continue;  // sesión de Supabase: es una credencial, no va al archivo
      local.localStorage[k] = localStorage.getItem(k);
    }
  } catch {}
  return local;
}

// ─── EXPORTAR ────────────────────────────────────────────────
export async function buildBackup() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No hay sesión iniciada.");

  const tables = {};
  const counts = {};
  const skipped = [];
  for (const t of TABLES) {
    try {
      tables[t.name] = await fetchAll(t.name, t.key || "id");
      counts[t.name] = tables[t.name].length;
    } catch (err) {
      if (missingTable(err)) { skipped.push(t.name); continue; }
      throw new Error(`No pude leer "${t.name}": ${err.message}`);
    }
  }

  const local = await readLocalData();
  const localCounts = {};
  if (local.indexeddb) for (const [k, v] of Object.entries(local.indexeddb.stores)) localCounts[k] = v.length;

  return {
    app: "daily",
    format: BACKUP_FORMAT,
    exported_at: new Date().toISOString(),
    user: { id: user.id, email: user.email },
    counts,
    local_counts: localCounts,
    skipped_tables: skipped,
    tables,
    local,
  };
}

export function backupFileName(date = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `daily-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}

export function downloadJSON(obj, fileName) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function exportAll() {
  const backup = await buildBackup();
  downloadJSON(backup, backupFileName());
  return backup;
}

// ─── IMPORTAR ────────────────────────────────────────────────
export function parseBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error("El archivo no es un JSON válido."); }
  if (!b || b.app !== "daily" || !b.tables) throw new Error("Este archivo no es un backup de Daily.");
  if (b.format > BACKUP_FORMAT) throw new Error("El backup es de una versión más nueva de la app. Actualizá la app primero.");
  return b;
}

const rowKey = (t, row) => row[t.key || "id"];

// Cuenta, sin tocar nada, cuántas filas del backup faltan hoy en la base.
export async function planImport(backup) {
  const plan = [];
  for (const t of TABLES.filter(t => t.restore)) {
    const rows = backup.tables[t.name];
    if (!rows || !rows.length) continue;
    let existing;
    try { existing = await fetchAll(t.name, t.key || "id"); }
    catch (err) { if (missingTable(err)) continue; throw err; }
    const have = new Set(existing.map(r => rowKey(t, r)));
    const missing = t.name === "settings" ? (existing.length ? [] : rows.slice(0, 1)) : rows.filter(r => !have.has(rowKey(t, r)));
    plan.push({ table: t.name, total: rows.length, missing });
  }
  const local = backup.local?.indexeddb?.stores || null;
  return { tables: plan, local, totalMissing: plan.reduce((s, p) => s + p.missing.length, 0) };
}

async function insertAddOnly(table, rows) {
  let added = 0, conflicts = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase.from(table).insert(chunk);
    if (!error) { added += chunk.length; continue; }
    // Si algo del lote choca con una fila existente (p. ej. misma rutina y día), se prueba de a una
    // y se saltean solo las que chocan. Nunca se pisa la existente.
    for (const row of chunk) {
      const { error: e } = await supabase.from(table).insert(row);
      if (!e) added++;
      else if (e.code === "23505" || e.code === "23503") conflicts++;
      else throw new Error(`No pude agregar en "${table}": ${e.message}`);
    }
  }
  return { added, conflicts };
}

async function restoreLocal(stores) {
  const db = await openLegacyDB();
  if (!db) return 0;
  let added = 0;
  for (const [name, rows] of Object.entries(stores)) {
    if (!db.objectStoreNames.contains(name) || !rows?.length) continue;
    for (const raw of rows) {
      const row = await deserialize(raw);
      // add() falla si la clave ya existe: así nunca se pisa nada local.
      const ok = await new Promise(resolve => {
        const tx = db.transaction(name, "readwrite");
        const req = tx.objectStore(name).add(row);
        req.onsuccess = () => resolve(true);
        req.onerror = e => { e.preventDefault(); resolve(false); };
      });
      if (ok) added++;
    }
  }
  db.close();
  return added;
}

export async function runImport(plan) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No hay sesión iniciada.");
  // Antes de agregar nada, se descarga una copia de cómo está todo ahora.
  await exportAll();
  const result = { tables: [], local: 0 };
  for (const p of plan.tables) {
    if (!p.missing.length) continue;
    // Las filas pasan a ser del usuario actual (así funciona también en un proyecto nuevo).
    const rows = p.missing.map(r => ("user_id" in r ? { ...r, user_id: user.id } : r));
    const r = await insertAddOnly(p.table, rows);
    result.tables.push({ table: p.table, ...r });
  }
  if (plan.local) result.local = await restoreLocal(plan.local);
  return result;
}
