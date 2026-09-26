import { useState, useEffect } from "react";
import { registerSW } from "./notifications";
import { supabase, syncTimezone } from "./supabase";
import Login from "./Login";
import AgendaView from "./Agenda";
import RoutinesView from "./Routines";
import BlocksView from "./Blocks";

const TABS = [
  ["agenda",   "📅 Agenda"],
  ["rutinas",  "🔁 Rutinas"],
  ["semana",   "⚙ Semana"],
];

const SHELL = { fontFamily: "'Segoe UI',system-ui,sans-serif", background: "#f5f2ec", color: "#1a1814", height: "100dvh", display: "flex", flexDirection: "column", width: "100%", maxWidth: 520, margin: "0 auto", position: "relative", fontSize: 14, overflowX: "hidden" };

export default function App() {
  const [session, setSession] = useState(undefined);  // undefined = todavía no se sabe
  const [view, setView]       = useState("agenda");

  useEffect(() => {
    registerSW();
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" && s) syncTimezone(s.user.id).catch(console.error);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div style={{ ...SHELL, alignItems: "center", justifyContent: "center", color: "#a09890", fontSize: 13 }}>Cargando…</div>;
  }

  return (
    <div style={SHELL}>
      <div style={{ background: "#f5f2ec", padding: "14px 16px 0", position: "sticky", top: 0, zIndex: 30, borderBottom: "1px solid #d8d2c6" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: session ? 11 : 14 }}>
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.7px" }}>Daily</span>
          <span style={{ fontFamily: "monospace", fontSize: 9, color: "#a09890" }}>
            {new Date().toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
          </span>
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
      {session && view === "semana"  && <BlocksView session={session} />}
    </div>
  );
}
