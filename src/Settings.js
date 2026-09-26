import { useState, useEffect } from "react";
import {
  supabase, fetchSettings, updateSettings,
  localTasksToMigrate, migrateLocalTasks, localNotesToMigrate, migrateLocalNotes,
} from "./supabase";
import { hhmm, FIELD, CHIP, GHOST_BTN, ERROR_BOX, SECTION } from "./ui";
import BlocksView from "./Blocks";
import PushSettings from "./PushSettings";

const CARD = { background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 };

function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} style={{ width: 16, height: 16, marginTop: 2 }} />
      <span style={{ fontSize: 13.5, lineHeight: 1.4 }}>
        {label}
        {hint && <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>{hint}</span>}
      </span>
    </label>
  );
}

// Tema: "auto" sigue al celu; "light"/"dark" se fuerzan con data-theme (ver theme.css e index.html).
const THEME_BG = { light: "#f5f2ec", dark: "#141311" };

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
  const choose = t => { setTheme(t); applyTheme(t); };
  return (
    <div style={CARD}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>Apariencia</div>
      <div style={{ display: "flex", gap: 6 }}>
        {[["auto", "Automático"], ["light", "☀ Claro"], ["dark", "☾ Oscuro"]].map(([k, label]) => (
          <button key={k} onClick={() => choose(k)} style={{ ...CHIP(theme === k), flex: 1 }}>{label}</button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Automático sigue el modo del celu.</div>
    </div>
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
  return (
    <div style={CARD}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>Qué avisos querés</div>
      <Toggle checked={prefs.notify_blocks} onChange={v => change("notify_blocks", v)} label="Al empezar cada bloque" hint="Con una tarea para arrancar." />
      <Toggle checked={prefs.notify_midblock} onChange={v => change("notify_midblock", v)} label="A mitad de bloques largos" hint="Un empujoncito en bloques de más de 90 minutos." />
      <Toggle checked={prefs.notify_ocio} onChange={v => change("notify_ocio", v)} label="Tiempo libre" hint="Cuando empieza y cuando termina el ocio." />
      <Toggle checked={prefs.notify_dayclose} onChange={v => change("notify_dayclose", v)} label="Cierre del día" hint="Lo que hiciste y con qué arrancás mañana." />
      <Toggle checked={prefs.notify_tasks} onChange={v => change("notify_tasks", v)} label="A la hora de una tarea" hint="Solo las que tienen hora." />
      <Toggle checked={prefs.notify_birthdays} onChange={v => change("notify_birthdays", v)} label="Cumpleaños" />
      <Toggle checked={prefs.birthday_day_before} onChange={v => change("birthday_day_before", v)} disabled={!prefs.notify_birthdays}
        label="Avisarme también el día antes del cumple" />
      <Toggle checked={prefs.notify_weekly} onChange={v => change("notify_weekly", v)} label="Resumen del domingo" hint="Domingo a las 20." />
      <div>
        <div style={{ fontSize: 13.5, marginBottom: 6 }}>Hora de los avisos de la mañana</div>
        <input type="time" value={hhmm(prefs.morning_time)} onChange={e => e.target.value && change("morning_time", e.target.value)}
          style={{ ...FIELD, fontFamily: "monospace", maxWidth: 140 }} />
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 5 }}>Cumpleaños y notas con fecha pero sin hora.</div>
      </div>
      {error && <div style={ERROR_BOX}>{error}</div>}
    </div>
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
      setStatus(`✓ Listo: ${t} tareas y ${n} notas/ideas. Si ya estaban subidas, no se duplican.`);
    } catch (err) { setStatus(`Error: ${err.message}`); }
    finally { setBusy(false); }
  }

  return (
    <div style={CARD}>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        En este dispositivo hay <b>{counts.tasks}</b> tareas con fecha y <b>{counts.notes}</b> notas, ideas o planes de la versión anterior. Los adjuntos no se suben.
      </div>
      <button onClick={migrate} disabled={busy} style={{ ...GHOST_BTN, opacity: busy ? 0.6 : 1 }}>{busy ? "Subiendo…" : "Subir a la nube"}</button>
      {status && <div style={{ fontSize: 12, color: status.startsWith("Error") ? "var(--bad)" : "var(--good)" }}>{status}</div>}
    </div>
  );
}

export default function SettingsView({ session, onClose }) {
  const [screen, setScreen] = useState("main");  // "main" | "blocks"

  const header = (title, back) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px 6px" }}>
      <button onClick={back} aria-label="Volver"
        style={{ width: 34, height: 34, borderRadius: "50%", border: "1.5px solid var(--border)", background: "transparent", fontSize: 16, cursor: "pointer", color: "var(--ink)" }}>←</button>
      <span style={{ fontWeight: 800, fontSize: 16 }}>{title}</span>
    </div>
  );

  if (screen === "blocks") {
    return <>{header("Bloques de la semana", () => setScreen("main"))}<BlocksView /></>;
  }

  return (
    <>
      {header("Configuración", onClose)}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 14px 40px", display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={() => setScreen("blocks")}
          style={{ ...CARD, flexDirection: "row", alignItems: "center", cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: "var(--ink)" }}>
          <span style={{ fontSize: 20 }}>🗓</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>Bloques de la semana</span>
            <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)" }}>Agregar, cambiar o borrar tu semana tipo</span>
          </span>
          <span style={{ color: "var(--ink-3)", fontSize: 18 }}>›</span>
        </button>

        <Appearance />

        <div style={{ ...SECTION, color: "var(--ink-2)" }}>Notificaciones</div>
        <PushSettings />
        <NotificationPrefs />

        <LocalData />

        <div style={{ ...SECTION, color: "var(--ink-2)" }}>Cuenta</div>
        <div style={{ ...CARD, flexDirection: "row", alignItems: "center" }}>
          <span style={{ flex: 1, fontSize: 13, color: "var(--ink-2)", wordBreak: "break-all" }}>{session.user.email}</span>
          <button onClick={() => supabase.auth.signOut()} style={{ ...GHOST_BTN, padding: "7px 12px" }}>Salir</button>
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 10, color: "var(--ink-3)", textAlign: "center" }}>
          Zona horaria: {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </div>
      </div>
    </>
  );
}
