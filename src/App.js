import { useState, useEffect } from "react";
import { registerSW, pushStatus } from "./notifications";
import { supabase, syncTimezone } from "./supabase";
import Login from "./Login";
import AgendaView from "./Agenda";
import RoutinesView from "./Routines";
import SummaryView from "./Summary";
import BlocksView from "./Blocks";

const TABS = [
  ["agenda",   "📅 Agenda"],
  ["rutinas",  "🔁 Rutinas"],
  ["resumen",  "📊 Resumen"],
  ["semana",   "⚙ Semana"],
];

// "/?view=resumen" (lo usa el push del domingo) abre directo esa pestaña.
function viewFromUrl(url = window.location.href) {
  const v = new URL(url, window.location.origin).searchParams.get("view");
  return TABS.some(([id]) => id === v) ? v : "agenda";
}

const SHELL = { fontFamily: "'Segoe UI',system-ui,sans-serif", background: "#f5f2ec", color: "#1a1814", height: "100dvh", display: "flex", flexDirection: "column", width: "100%", maxWidth: 520, margin: "0 auto", position: "relative", fontSize: 14, overflowX: "hidden" };

export default function App() {
  const [session, setSession] = useState(undefined);  // undefined = todavía no se sabe
  const [view, setView]       = useState(viewFromUrl);
  const [pushOff, setPushOff] = useState(false);

  useEffect(() => {
    registerSW();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" && s) syncTimezone(s.user.id).catch(console.error);
    });
    // Tocar una notificación con la app abierta: el service worker avisa a qué vista ir.
    const onMessage = e => { if (e.data?.type === "navigate") setView(viewFromUrl(e.data.url)); };
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
    return <div style={{ ...SHELL, alignItems: "center", justifyContent: "center", color: "#a09890", fontSize: 13 }}>Cargando…</div>;
  }

  return (
    <div style={SHELL}>
      <div style={{ background: "#f5f2ec", padding: "14px 16px 0", position: "sticky", top: 0, zIndex: 30, borderBottom: "1px solid #d8d2c6" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: session ? 11 : 14 }}>
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.7px" }}>Daily</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {session && pushOff && view !== "semana" && (
              <button onClick={() => setView("semana")}
                style={{ background: "#eef3fd", border: "1.5px solid #2563c4", color: "#2563c4", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                🔔 Avisos
              </button>
            )}
            <span style={{ fontFamily: "monospace", fontSize: 9, color: "#a09890" }}>
              {new Date().toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
            </span>
          </div>
        </div>
        {session && (
          <div style={{ display: "flex" }}>
            {TABS.map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                style={{ flex: 1, padding: "8px 4px", border: "none", background: "transparent", fontFamily: "inherit", fontSize: 12, fontWeight: view === v ? 700 : 500, color: view === v ? "#1a1814" : "#a09890", cursor: "pointer", borderBottom: `2px solid ${view === v ? "#1a1814" : "transparent"}` }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!session && <Login />}
      {session && view === "agenda"  && <AgendaView />}
      {session && view === "rutinas" && <RoutinesView />}
      {session && view === "resumen" && <SummaryView />}
      {session && view === "semana"  && <BlocksView session={session} />}
    </div>
  );
}
