import { useState, useEffect } from "react";
import { fetchWeekStats, fetchSavedSummary } from "./supabase";
import { BLOCK_TYPE, parseYmd, todayStr, addDays, weekDates, durationLabel, ERROR_BOX, SECTION } from "./ui";

const INK = "#1a1814", INK_2 = "#6b6457", INK_3 = "#a09890", TRACK = "#ede9e1";

function weekLabel(start) {
  const end = addDays(start, 6);
  const s = parseYmd(start), e = parseYmd(end);
  const month = d => d.toLocaleDateString("es-AR", { month: "short" });
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()} al ${e.getDate()} ${month(e)}`
    : `${s.getDate()} ${month(s)} al ${e.getDate()} ${month(e)}`;
}

function Tile({ value, label, note }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: "#fff", border: "1.5px solid #d8d2c6", borderRadius: 14, padding: "10px 12px" }}>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-1px", color: INK, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: INK_2, marginTop: 2 }}>{label}</div>
      {note && <div style={{ fontFamily: "monospace", fontSize: 10, color: INK_3, marginTop: 3 }}>{note}</div>}
    </div>
  );
}

// Barra de avance: relleno = parte hecha. Siempre acompañada de su etiqueta y números en texto.
function Progress({ done, total, color }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div role="img" aria-label={`${done} de ${total} (${pct}%)`} style={{ height: 6, background: TRACK, borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: "#fff", border: "1.5px solid #d8d2c6", borderRadius: 15, padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...SECTION, color: INK_2, padding: 0 }}>{title}</div>
      {children}
    </div>
  );
}

export default function SummaryView() {
  const thisWeek = weekDates(todayStr())[0];
  const [weekStart, setWeekStart] = useState(thisWeek);
  const [stats, setStats]         = useState(null);
  const [saved, setSaved]         = useState(false);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Semana pasada con snapshot → el snapshot; si no, cálculo en vivo.
    fetchSavedSummary(weekStart)
      .then(s => s ? [s.stats, true] : fetchWeekStats(weekStart).then(st => [st, false]))
      .then(([st, isSaved]) => { if (alive) { setStats(st); setSaved(isSaved); setError(""); } })
      .catch(err => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [weekStart]);

  const isCurrent = weekStart === thisWeek;
  const diff = stats ? stats.done - stats.done_prev : 0;
  const diffNote = !stats ? null : diff > 0 ? `▲ ${diff} más que la anterior` : diff < 0 ? `▼ ${-diff} menos que la anterior` : "igual que la anterior";
  const types = stats?.by_type || [];
  const routines = stats?.routines || [];
  const stuck = stats?.stuck || [];
  const empty = stats && !stats.done && !stats.pending && !types.length;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 40px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semana anterior" style={NAV_BTN}>‹</button>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{isCurrent ? "Esta semana" : `Semana del ${weekLabel(weekStart)}`}</div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: INK_3 }}>
            {isCurrent ? `${weekLabel(weekStart)} · en curso` : saved ? "resumen del domingo" : "calculado ahora"}
          </div>
        </div>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} disabled={isCurrent} aria-label="Semana siguiente"
          style={{ ...NAV_BTN, opacity: isCurrent ? 0.3 : 1 }}>›</button>
      </div>

      {error && <div style={ERROR_BOX}>{error}</div>}
      {loading && !stats && <div style={{ color: INK_3, fontSize: 13, padding: 20, textAlign: "center" }}>Cargando…</div>}

      {stats && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Tile value={stats.done} label={stats.done === 1 ? "tarea hecha" : "tareas hechas"} note={diffNote} />
            <Tile value={`🔥 ${stats.streak}`} label={stats.streak === 1 ? "día de racha" : "días de racha"} />
            <Tile value={`${stats.active_days}/7`} label="días activos" />
          </div>

          {empty && (
            <div style={{ textAlign: "center", color: INK_3, fontSize: 13, padding: "24px 10px" }}>Sin actividad esta semana.</div>
          )}

          {types.length > 0 && (
            <Card title="Por bloque">
              {types.map(t => {
                const meta = BLOCK_TYPE[t.type] || { icon: "·", label: "Sin bloque", color: "#a09890" };
                return (
                  <div key={t.type || "none"} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: INK, flex: 1 }}>{meta.icon} {meta.label}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: INK_2 }}>
                        {t.done} hecha{t.done === 1 ? "" : "s"}{t.pending ? ` · ${t.pending} pend.` : ""}
                      </span>
                    </div>
                    <Progress done={t.done} total={t.done + t.pending} color={meta.color} />
                    {t.planned_minutes > 0 && (
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: INK_3 }}>{durationLabel(t.planned_minutes)} de bloque en la semana</span>
                    )}
                  </div>
                );
              })}
            </Card>
          )}

          {routines.length > 0 && (
            <Card title="Rutinas">
              {routines.map((r, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13.5, color: INK, flex: 1 }}>🔁 {r.text}</span>
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: INK_2 }}>{r.done}/{r.total}</span>
                  </div>
                  <Progress done={r.done} total={r.total} color={INK} />
                </div>
              ))}
            </Card>
          )}

          {stuck.length > 0 && (
            <Card title="Se vienen pasando">
              {stuck.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13.5, color: INK, flex: 1, wordBreak: "break-word" }}>{s.text}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: INK_2, whiteSpace: "nowrap" }}>↻ {s.rollover_count} veces</span>
                </div>
              ))}
            </Card>
          )}

          <div style={{ fontFamily: "monospace", fontSize: 10.5, color: INK_3, textAlign: "center", lineHeight: 1.7 }}>
            {stats.planned_minutes > 0 && <>{durationLabel(stats.planned_minutes)} de bloques planificados</>}
            {stats.atypical_days > 0 && <> · {stats.atypical_days} día{stats.atypical_days === 1 ? "" : "s"} atípico{stats.atypical_days === 1 ? "" : "s"}</>}
            {isCurrent && <><br />El domingo a las 20 te llega el resumen.</>}
          </div>
        </div>
      )}
    </div>
  );
}

const NAV_BTN = { width: 34, height: 34, borderRadius: "50%", border: "1.5px solid #d8d2c6", background: "transparent", fontSize: 18, lineHeight: 1, cursor: "pointer", color: "#1a1814", fontFamily: "inherit" };
