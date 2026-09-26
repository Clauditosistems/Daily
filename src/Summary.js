import { useState, useEffect } from "react";
import { fetchWeekStats, fetchSavedSummary } from "./supabase";
import Heatmap from "./Heatmap";
import { BLOCK_TYPE, parseYmd, todayStr, addDays, weekDates, durationLabel, ERROR_BOX, SECTION } from "./ui";

// Primero lo logrado; lo pendiente al final y en neutro. Nunca comparaciones hacia abajo.
const INK = "var(--ink)", INK_2 = "var(--ink-2)", INK_3 = "var(--ink-3)", TRACK = "var(--surface-2)";

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
    <div style={{ flex: 1, minWidth: 0, background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 14, padding: "10px 12px" }}>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-1px", color: INK, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: INK_2, marginTop: 2 }}>{label}</div>
      {note && <div style={{ fontFamily: "monospace", fontSize: 10, color: INK_3, marginTop: 3 }}>{note}</div>}
    </div>
  );
}

function Progress({ done, total, color }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div role="img" aria-label={`${pct}%`} style={{ height: 6, background: TRACK, borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 15, padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ ...SECTION, color: INK_2, padding: 0 }}>{title}</div>
      {children}
    </div>
  );
}

const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0);

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
    // Semana pasada con snapshot (del formato nuevo) → el snapshot; si no, cálculo en vivo.
    fetchSavedSummary(weekStart)
      .then(s => (s && s.stats.blocks_total !== undefined) ? [s.stats, true] : fetchWeekStats(weekStart).then(st => [st, false]))
      .then(([st, isSaved]) => { if (alive) { setStats(st); setSaved(isSaved); setError(""); } })
      .catch(err => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [weekStart]);

  const isCurrent = weekStart === thisWeek;
  const better = stats && stats.done_prev > 0 && stats.done > stats.done_prev ? stats.done - stats.done_prev : 0;
  const weekPct = stats ? pctOf(stats.blocks_done, stats.blocks_total) : 0;
  const types = (stats?.by_type || []).filter(t => t.blocks_total > 0 || t.done > 0);
  const routines = (stats?.routines || []).filter(r => r.done > 0);
  const empty = stats && !stats.done && !stats.blocks_done;

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
            <Tile value={stats.done} label={stats.done === 1 ? "cosa hecha" : "cosas hechas"} note={better ? `▲ ${better} más que la anterior` : null} />
            <Tile value={`${weekPct}%`} label={isCurrent ? "de tus bloques, por ahora" : "de tus bloques"} />
            <Tile value={`🔥 ${stats.streak_weeks}`} label={stats.streak_weeks === 1 ? "semana de racha" : "semanas de racha"}
              note={stats.best_streak > stats.streak_weeks ? `mejor: ${stats.best_streak}` : null} />
          </div>

          <div style={{ fontSize: 12, color: INK_2, textAlign: "center", lineHeight: 1.5 }}>
            La racha suma cada semana en la que cumplís la mitad de tus bloques o más. Un día malo no la rompe.
          </div>

          {empty && <div style={{ textAlign: "center", color: INK_3, fontSize: 13, padding: "18px 10px" }}>La semana recién arranca.</div>}

          {types.length > 0 && (
            <Card title="Por categoría">
              {types.map(t => {
                const meta = BLOCK_TYPE[t.type] || { icon: "·", label: "Sin bloque", color: "var(--ink-3)" };
                return (
                  <div key={t.type || "none"} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: INK, flex: 1 }}>{meta.icon} {meta.label}</span>
                      {t.blocks_total > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{pctOf(t.blocks_done, t.blocks_total)}%</span>}
                    </div>
                    {t.blocks_total > 0 && <Progress done={t.blocks_done} total={t.blocks_total} color={meta.color} />}
                    <span style={{ fontFamily: "monospace", fontSize: 10.5, color: INK_3 }}>
                      {t.blocks_total > 0 ? `${t.blocks_done} de ${t.blocks_total} bloques` : ""}
                      {t.blocks_total > 0 && t.done > 0 ? " · " : ""}
                      {t.done > 0 ? `${t.done} ${t.done === 1 ? "cosa hecha" : "cosas hechas"}` : ""}
                    </span>
                  </div>
                );
              })}
            </Card>
          )}

          {routines.length > 0 && (
            <Card title="Rutinas">
              {routines.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13.5, color: INK, flex: 1 }}>🔁 {r.text}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--good)", fontWeight: 700 }}>
                    {r.done} {r.done === 1 ? "vez" : "veces"} ✓
                  </span>
                </div>
              ))}
            </Card>
          )}

          <Heatmap />

          <div style={{ fontFamily: "monospace", fontSize: 10.5, color: INK_3, textAlign: "center", lineHeight: 1.8 }}>
            {stats.active_days > 0 && <>{stats.active_days} día{stats.active_days === 1 ? "" : "s"} con avances</>}
            {stats.active_days > 0 && stats.planned_minutes > 0 && " · "}
            {stats.planned_minutes > 0 && <>{durationLabel(stats.planned_minutes)} de bloques</>}
            {stats.atypical_days > 0 && <> · {stats.atypical_days} día{stats.atypical_days === 1 ? "" : "s"} atípico{stats.atypical_days === 1 ? "" : "s"} (no cuentan)</>}
            {stats.pending > 0 && <><br />Para seguir: {stats.pending} cosa{stats.pending === 1 ? "" : "s"}</>}
            {isCurrent && <><br />El domingo a las 20 te llega el resumen.</>}
          </div>
        </div>
      )}
    </div>
  );
}

const NAV_BTN = { width: 34, height: 34, borderRadius: "50%", border: "1.5px solid var(--border)", background: "transparent", fontSize: 18, lineHeight: 1, cursor: "pointer", color: "var(--ink)", fontFamily: "inherit" };
