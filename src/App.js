import { useState, useEffect } from "react";
import { registerSW, pushStatus } from "./notifications";
import { supabase, syncTimezone } from "./supabase";
import Login from "./Login";
import AgendaView from "./Agenda";
import RoutinesView from "./Routines";
import SummaryView from "./Summary";
import NotesView from "./Notes";
import SettingsView from "./Settings";

const TABS = [
  ["agenda",   "📅 Agenda"],
  ["rutinas",  "🔁 Rutinas"],
  ["notas",    "📝 Notas"],
  ["resumen",  "📊 Resumen"],
];

// "/?view=resumen" (push del domingo) o "/?view=agenda&mode=ahora" (avisos de bloque) abren esa vista.
function viewFromUrl(url = window.location.href) {
  const v = new URL(url, window.location.origin).searchParams.get("view");
  return TABS.some(([id]) => id === v) ? v : "agenda";
}

function modeFromUrl(url = window.location.href, n = 0) {
  const m = new URL(url, window.location.origin).searchParams.get("mode");
  return m ? { mode: m, n } : null;
}

const SHELL = { fontFamily: "'Segoe UI',system-ui,sans-serif", background: "var(--bg)", color: "var(--ink)", height: "100dvh", display: "flex", flexDirection: "column", width: "100%", maxWidth: 520, margin: "0 auto", position: "relative", fontSize: 14, overflowX: "hidden" };

export default function App() {
  const [session, setSession] = useState(undefined);  // undefined = todavía no se sabe
  const [view, setView]       = useState(viewFromUrl);
  const [pushOff, setPushOff] = useState(false);
  const [forceMode, setForceMode] = useState(() => modeFromUrl());

  useEffect(() => {
    registerSW();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" && s) syncTimezone(s.user.id).catch(console.error);
    });
    // Tocar una notificación con la app abierta: el service worker avisa a qué vista ir.
    const onMessage = e => {
      if (e.data?.type !== "navigate") return;
      setView(viewFromUrl(e.data.url));
      const m = modeFromUrl(e.data.url, Date.now());
      if (m) setForceMode(m);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      subscription.unsubscribe();
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    if (session) pushStatus().then(s => setPushOff(s === "off" || s === "install")).catch(() => {});
  }, [session, view]);

  if (session === undefined) {
    return <div style={{ ...SHELL, alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 13 }}>Cargando…</div>;
  }

  return (
    <div style={SHELL}>
      <div style={{ background: "var(--bg)", padding: "14px 16px 0", position: "sticky", top: 0, zIndex: 30, borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: session ? 11 : 14 }}>
          <button onClick={() => session && setView(view === "config" ? "agenda" : "config")} aria-label="Configuración"
            style={{ background: "none", border: "none", padding: 0, cursor: session ? "pointer" : "default", fontFamily: "inherit", color: "inherit", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.7px" }}>Daily</span>
            {session && <span style={{ fontSize: 13, color: view === "config" ? "var(--ink)" : "var(--ink-3)" }}>⚙</span>}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {session && pushOff && view !== "config" && (
              <button onClick={() => setView("config")}
                style={{ background: "var(--info-bg)", border: "1.5px solid var(--info)", color: "var(--info)", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                🔔 Avisos
              </button>
            )}
            <span style={{ fontFamily: "monospace", fontSize: 9, color: "var(--ink-3)" }}>
              {new Date().toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
            </span>
          </div>
        </div>
        {session && (
          <div style={{ display: "flex" }}>
            {TABS.map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                style={{ flex: 1, padding: "8px 4px", border: "none", background: "transparent", fontFamily: "inherit", fontSize: 12, fontWeight: view === v ? 700 : 500, color: view === v ? "var(--ink)" : "var(--ink-3)", cursor: "pointer", borderBottom: `2px solid ${view === v ? "var(--ink)" : "transparent"}` }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!session && <Login />}
      {session && view === "agenda"  && <AgendaView forceMode={forceMode} />}
      {session && view === "rutinas" && <RoutinesView />}
      {session && view === "resumen" && <SummaryView />}
      {session && view === "notas"   && <NotesView />}
      {session && view === "config"  && <SettingsView session={session} onClose={() => setView("agenda")} />}
    </div>
  );
}
