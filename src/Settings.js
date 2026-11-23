import { useState, useEffect, useRef } from "react";
import { exportAll, parseBackup, planImport, runImport } from "./backup";
import {
  supabase, fetchSettings, updateSettings,
  localTasksToMigrate, migrateLocalTasks, localNotesToMigrate, migrateLocalNotes,
} from "./supabase";
import {
  hhmm, ERROR_BOX, GHOST_BTN, PRIMARY_BTN, DANGER_BTN, Group, Row, Toggle, Segmented, ScreenTitle, useBackHandler, hapticsOn, setHaptics, haptic,
} from "./ui";
import BlocksView from "./Blocks";
import PushSettings from "./PushSettings";

// Tema: "auto" sigue al celu; "light"/"dark" se fuerzan con data-theme (ver theme.css e index.html).
const THEME_BG = { light: "#f2f2f7", dark: "#111113" };

function readTheme() {
  try { return localStorage.getItem("daily-theme") || "auto"; } catch { return "auto"; }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "auto") delete root.dataset.theme; else root.dataset.theme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    m.content = theme === "auto" ? THEME_BG[m.media.includes("dark") ? "dark" : "light"] : THEME_BG[theme];
  });
  try { if (theme === "auto") localStorage.removeItem("daily-theme"); else localStorage.setItem("daily-theme", theme); } catch {}
}

function Appearance() {
  const [theme, setTheme] = useState(readTheme);
  const [vibrate, setVibrate] = useState(hapticsOn);
  return (
    <Group header="Apariencia" footer="Automático sigue el modo del celu.">
      <div style={{ padding: 12 }}>
        <Segmented label="Tema" value={theme} onChange={t => { setTheme(t); applyTheme(t); }}
          options={[["auto", "Automático"], ["light", "Claro"], ["dark", "Oscuro"]]} />
      </div>
      <Row divider>
        <span style={{ flex: 1 }}>Vibrar al completar</span>
        <Toggle label="Vibrar al completar" checked={vibrate} onChange={v => { setVibrate(v); setHaptics(v); if (v) haptic(); }} />
      </Row>
    </Group>
  );
}

function PrefRow({ label, hint, checked, onChange, disabled, divider }) {
  return (
    <Row divider={divider}>
      <span style={{ flex: 1, minWidth: 0, opacity: disabled ? 0.45 : 1 }}>
        {label}
        {hint && <span style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{hint}</span>}
      </span>
      <Toggle label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </Row>
  );
}

function NotificationPrefs() {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { fetchSettings().then(setPrefs).catch(err => setError(err.message)); }, []);

  async function change(key, value) {
    const prev = prefs;
    setPrefs(p => ({ ...p, [key]: value }));  // optimista
    try { setPrefs(await updateSettings({ [key]: value })); }
    catch (err) { setPrefs(prev); setError(err.message); }
  }

  if (!prefs) return error ? <div style={ERROR_BOX}>{error}</div> : null;
  const rows = [
    ["notify_blocks", "Al empezar cada bloque", "Con una tarea para arrancar."],
    ["notify_midblock", "A mitad de bloques largos", "Un empujoncito en bloques de más de 90 minutos."],
    ["notify_ocio", "Tiempo libre", "Cuando empieza y cuando termina."],
    ["notify_dayclose", "Cierre del día", "Lo que hiciste y con qué arrancás mañana."],
    ["notify_tasks", "A la hora de una tarea", "Solo las que tienen hora."],
    ["notify_weekly", "Resumen del domingo", "Domingo a las 20."],
  ];
  return (
    <>
      <Group header="Qué avisos querés">
        {rows.map(([key, label, hint], i) => (
          <PrefRow key={key} divider={i > 0} label={label} hint={hint} checked={prefs[key]} onChange={v => change(key, v)} />
        ))}
      </Group>
      <Group header="Planes, cumpleaños y notas" footer="Los avisos del día antes y las notas con fecha pero sin hora llegan a la hora de la mañana.">
        <PrefRow label="Planes" hint="Te aviso el día antes." checked={prefs.notify_plans ?? true} onChange={v => change("notify_plans", v)} />
        <PrefRow divider label="Cumpleaños" checked={prefs.notify_birthdays} onChange={v => change("notify_birthdays", v)} />
        <PrefRow divider label="También el día antes" checked={prefs.birthday_day_before} disabled={!prefs.notify_birthdays}
          onChange={v => change("birthday_day_before", v)} />
        <Row divider>
          <span style={{ flex: 1 }}>Hora de la mañana</span>
          <input type="time" value={hhmm(prefs.morning_time)} onChange={e => e.target.value && change("morning_time", e.target.value)}
            aria-label="Hora de los avisos de la mañana" className="num"
            style={{ border: "none", background: "var(--surface-2)", borderRadius: 8, padding: "6px 10px", fontSize: 16, fontFamily: "inherit", color: "var(--ink)" }} />
        </Row>
      </Group>
      {error && <div style={ERROR_BOX}>{error}</div>}
    </>
  );
}

const TABLE_LABEL = {
  settings: "configuración", weekly_blocks: "bloques", routines: "rutinas", tasks: "tareas",
  block_overrides: "cambios de bloques", day_overrides: "días atípicos", block_checkins: "\"estuve\"",
  notes: "notas", birthdays: "cumpleaños", weekly_summaries: "resúmenes", push_subscriptions: "dispositivos", push_log: "avisos enviados",
};
const fmtDate = iso => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Backup() {
  const [busy, setBusy]     = useState("");   // "export" | "read" | "import"
  const [status, setStatus] = useState("");
  const [error, setError]   = useState("");
  const [pending, setPending] = useState(null);  // { backup, plan }
  const fileRef = useRef(null);

  async function doExport() {
    setBusy("export"); setError(""); setStatus("");
    try {
      const b = await exportAll();
      const total = Object.values(b.counts).reduce((s, n) => s + n, 0);
      const local = Object.values(b.local_counts).reduce((s, n) => s + n, 0);
      setStatus(`Listo: ${total} registros${local ? ` y ${local} de este dispositivo` : ""}. Quedó en Descargas.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(""); }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("read"); setError(""); setStatus(""); setPending(null);
    try {
      const backup = parseBackup(await file.text());
      setPending({ backup, plan: await planImport(backup) });
    } catch (err) { setError(err.message); }
    finally { setBusy(""); }
  }

  async function doImport() {
    setBusy("import"); setError(""); setStatus("");
    try {
      const r = await runImport(pending.plan);  // descarga primero una copia de lo que hay ahora
      const added = r.tables.reduce((s, t) => s + t.added, 0);
      const skipped = r.tables.reduce((s, t) => s + t.conflicts, 0);
      setStatus(`Listo: se agregaron ${added} registros${r.local ? ` y ${r.local} de este dispositivo` : ""}.` +
        (skipped ? ` ${skipped} ya tenían su lugar ocupado y se dejaron como estaban.` : "") +
        " Antes se descargó una copia de cómo estaba todo.");
      setPending(null);
    } catch (err) { setError(err.message); }
    finally { setBusy(""); }
  }

  const missingRows = pending?.plan.tables.filter(p => p.missing.length) || [];
  const localRows = pending?.plan.local ? Object.values(pending.plan.local).reduce((s, v) => s + (v?.length || 0), 0) : 0;

  return (
    <Group header="Tus datos"
      footer={status || "Exportar baja un archivo con todo: bloques, tareas, rutinas, notas, ajustes y lo que haya quedado guardado en este celu. Importar solo agrega lo que falta; nunca borra ni cambia nada."}>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {!pending && <>
          <button onClick={doExport} disabled={!!busy} style={{ ...GHOST_BTN, opacity: busy ? 0.6 : 1 }}>
            {busy === "export" ? "Preparando…" : "Exportar todo"}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={!!busy} style={{ ...GHOST_BTN, opacity: busy ? 0.6 : 1 }}>
            {busy === "read" ? "Leyendo…" : "Importar backup"}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} style={{ display: "none" }} />
        </>}

        {pending && (
          <>
            <div style={{ fontSize: 15, lineHeight: 1.45 }}>
              Backup del {fmtDate(pending.backup.exported_at)}.{" "}
              {pending.plan.totalMissing === 0 && !localRows
                ? "Ya tenés todo lo que tiene este archivo. No hace falta agregar nada."
                : <>Se van a agregar solo los registros que faltan:</>}
            </div>
            {(missingRows.length > 0 || localRows > 0) && (
              <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6 }}>
                {missingRows.map(p => <div key={p.table}>{p.missing.length} {TABLE_LABEL[p.table] || p.table}</div>)}
                {localRows > 0 && <div>Datos de la versión anterior en este celu (solo los que no estén)</div>}
              </div>
            )}
            <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45 }}>
              Lo que ya tenés no se toca. Antes de empezar se descarga una copia de cómo está todo ahora.
            </div>
            {(pending.plan.totalMissing > 0 || localRows > 0) && (
              <button onClick={doImport} disabled={!!busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.6 : 1 }}>
                {busy === "import" ? "Agregando…" : "Agregar lo que falta"}
              </button>
            )}
            <button onClick={() => setPending(null)} disabled={!!busy} style={{ ...GHOST_BTN, opacity: busy ? 0.6 : 1 }}>
              {pending.plan.totalMissing > 0 || localRows > 0 ? "Cancelar" : "Listo"}
            </button>
          </>
        )}
        {error && <div style={ERROR_BOX}>{error}</div>}
      </div>
    </Group>
  );
}

function LocalData() {
  const [counts, setCounts] = useState(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy]     = useState(false);

  useEffect(() => {
    Promise.all([localTasksToMigrate(), localNotesToMigrate()])
      .then(([t, n]) => setCounts({ tasks: t.length, notes: n.length }))
      .catch(() => setCounts({ tasks: 0, notes: 0 }));
  }, []);

  if (!counts || (!counts.tasks && !counts.notes)) return null;

  async function migrate() {
    setBusy(true); setStatus("");
    try {
      const [t, n] = [await migrateLocalTasks(), await migrateLocalNotes()];
      setStatus(`Listo: ${t} tareas y ${n} notas o ideas. Si ya estaban subidas, no se duplican.`);
    } catch (err) { setStatus(`Error: ${err.message}`); }
    finally { setBusy(false); }
  }

  return (
    <Group header="Datos de la versión anterior" footer={status || "Los adjuntos no se suben."}>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 15, lineHeight: 1.45 }}>
          En este dispositivo hay {counts.tasks} tareas con fecha y {counts.notes} notas, ideas o planes.
        </div>
        <button onClick={migrate} disabled={busy} style={{ ...GHOST_BTN, opacity: busy ? 0.6 : 1 }}>{busy ? "Subiendo…" : "Subir a la nube"}</button>
      </div>
    </Group>
  );
}

export default function SettingsView({ session, onClose }) {
  const [screen, setScreen] = useState("main");  // "main" | "blocks"
  useBackHandler(screen === "blocks", () => setScreen("main"));

  if (screen === "blocks") {
    return (
      <>
        <ScreenTitle title="Tu semana" subtitle="Se repite todas las semanas." back={() => setScreen("main")} backLabel="Configuración" />
        <BlocksView />
      </>
    );
  }

  return (
    <>
      <ScreenTitle title="Configuración" back={onClose} backLabel="Agenda" />
      <div className="view-in" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 40px", display: "flex", flexDirection: "column", gap: 24 }}>
        <Group>
          <Row onClick={() => setScreen("blocks")} chevron>
            <span style={{ flex: 1 }}>
              Bloques de la semana
              <span style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>Tu semana tipo: agregar, cambiar o borrar</span>
            </span>
          </Row>
        </Group>

        <PushSettings />
        <NotificationPrefs />
        <Appearance />
        <Backup />
        <LocalData />

        <Group header="Cuenta" footer={`Zona horaria: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}>
          <Row>
            <span style={{ flex: 1, minWidth: 0, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis" }}>{session.user.email}</span>
          </Row>
          <Row divider onClick={() => supabase.auth.signOut()}>
            <span style={{ ...DANGER_BTN, padding: 0 }}>Cerrar sesión</span>
          </Row>
        </Group>
      </div>
    </>
  );
}
