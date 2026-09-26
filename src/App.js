import { useState, useEffect } from "react";
import { registerSW, pushStatus } from "./notifications";
import { supabase, syncTimezone } from "./supabase";
import Login from "./Login";
import AgendaView from "./Agenda";
import RoutinesView from "./Routines";
import SummaryView from "./Summary";
import NotesView from "./Notes";
import SettingsView from "./Settings";
import { Icon, useBackHandler } from "./ui";

const TABS = [
  ["agenda",  "Agenda",  "calendar"],
  ["rutinas", "Rutinas", "repeat"],
  ["notas",   "Notas",   "note"],
  ["resumen", "Resumen", "chart"],
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

const SHELL = { fontFamily: "var(--font)", background: "var(--bg)", color: "var(--ink)", height: "100dvh", display: "flex", flexDirection: "column", width: "100%", maxWidth: 520, margin: "0 auto", position: "relative", fontSize: 16, overflowX: "hidden" };
const ICON_BTN = { width: 36, height: 36, borderRadius: "50%", border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 };

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

  // Android: "atrás" desde otra sección vuelve a la Agenda en vez de salir de la app.
  useBackHandler(!!session && view !== "agenda", () => setView("agenda"));

  useEffect(() => {
    if (session) pushStatus().then(s => setPushOff(s === "off" || s === "install")).catch(() => {});
  }, [session, view]);

  if (session === undefined) {
    return <div style={{ ...SHELL, alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 13 }}>Cargando…</div>;
  }

  return (
    <div style={SHELL}>
      {/* Barra superior de vidrio: marca + accesos. Los títulos grandes viven en cada vista. */}
      <div className="glass" style={{ position: "sticky", top: 0, zIndex: 30, padding: "calc(8px + env(safe-area-inset-top)) 12px 8px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "0.5px solid var(--border)" }}>
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>Daily</span>
        {session && (
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {pushOff && view !== "config" && (
              <button onClick={() => setView("config")} aria-label="Activar avisos" style={ICON_BTN}><Icon name="bell" /></button>
            )}
            <button onClick={() => setView(view === "config" ? "agenda" : "config")} aria-label="Configuración"
              style={{ ...ICON_BTN, color: view === "config" ? "var(--ink)" : "var(--accent)" }}>
              <Icon name="gear" />
            </button>
          </div>
        )}
      </div>

      {!session && <Login />}
      {session && view === "agenda"  && <AgendaView forceMode={forceMode} />}
      {session && view === "rutinas" && <RoutinesView />}
      {session && view === "resumen" && <SummaryView />}
      {session && view === "notas"   && <NotesView />}
      {session && view === "config"  && <SettingsView session={session} onClose={() => setView("agenda")} />}

      {/* Pestañas abajo, a mano del pulgar, en vidrio. */}
      {session && (
        <nav className="glass" aria-label="Secciones" style={{ display: "flex", borderTop: "0.5px solid var(--border)", padding: "6px 6px calc(6px + env(safe-area-inset-bottom))" }}>
          {TABS.map(([v, label, icon]) => {
            const active = view === v;
            return (
              <button key={v} onClick={() => setView(v)} aria-current={active ? "page" : undefined}
                style={{ flex: 1, border: "none", background: "none", cursor: "pointer", padding: "4px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  color: active ? "var(--accent)" : "var(--ink-3)", fontFamily: "inherit" }}>
                <Icon name={icon} size={24} stroke={active ? 2.1 : 1.8} />
                <span style={{ fontSize: 10.5, fontWeight: active ? 600 : 500 }}>{label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
