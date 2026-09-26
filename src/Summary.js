import { useState, useEffect } from "react";
import { fetchWeekStats, fetchSavedSummary } from "./supabase";
import Heatmap from "./Heatmap";
import { BLOCK_TYPE, parseYmd, todayStr, addDays, weekDates, durationLabel, ERROR_BOX, CARD, LARGE_TITLE, Group, Row, Icon } from "./ui";

// Primero lo logrado; lo pendiente al final y en neutro. Nunca comparaciones hacia abajo.

function weekLabel(start) {
  const end = addDays(start, 6);
  const s = parseYmd(start), e = parseYmd(end);
  const month = d => d.toLocaleDateString("es-AR", { month: "short" }).replace(".", "");
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()} al ${e.getDate()} de ${month(e)}`
    : `${s.getDate()} de ${month(s)} al ${e.getDate()} de ${month(e)}`;
}

function Tile({ value, label, note }) {
  return (
    <div style={{ ...CARD, flex: 1, minWidth: 0, padding: "14px 14px 12px" }}>
      <div className="num" style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.05, color: "var(--ink)" }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.3 }}>{label}</div>
      {note && <div className="num" style={{ fontSize: 12, color: "var(--good)", marginTop: 4, fontWeight: 600 }}>{note}</div>}
    </div>
  );
}

function Bar({ done, total, color }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div role="img" aria-label={`${pct}%`} style={{ height: 4, background: "var(--surface-2)", borderRadius: 2, overflow: "hidden", marginTop: 8 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2 }} />
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

  const footer = stats && [
    stats.active_days > 0 && `${stats.active_days} día${stats.active_days === 1 ? "" : "s"} con avances`,
    stats.planned_minutes > 0 && `${durationLabel(stats.planned_minutes)} de bloques`,
    stats.atypical_days > 0 && `${stats.atypical_days} día${stats.atypical_days === 1 ? "" : "s"} atípico${stats.atypical_days === 1 ? "" : "s"}, que no cuentan`,
  ].filter(Boolean).join(". ");

  return (
    <>
      <div style={{ padding: "14px 16px 12px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={LARGE_TITLE}>{isCurrent ? "Esta semana" : "Semana"}</div>
          <div style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 4 }}>
            {weekLabel(weekStart)}{isCurrent ? ", en curso" : saved ? ", resumen del domingo" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semana anterior" style={NAV_BTN}><Icon name="left" size={18} stroke={2.2} /></button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} disabled={isCurrent} aria-label="Semana siguiente"
            style={{ ...NAV_BTN, opacity: isCurrent ? 0.35 : 1 }}><Icon name="right" size={18} stroke={2.2} /></button>
        </div>
      </div>

      <div className="view-in" key={weekStart} style={{ flex: 1, overflowY: "auto", padding: "4px 16px 40px", display: "flex", flexDirection: "column", gap: 24, opacity: loading ? 0.55 : 1, transition: "opacity 0.2s" }}>
        {error && <div style={ERROR_BOX}>{error}</div>}
        {loading && !stats && <div style={{ color: "var(--ink-2)", fontSize: 15, padding: 20, textAlign: "center" }}>Cargando…</div>}

        {stats && <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <Tile value={stats.done} label={stats.done === 1 ? "cosa hecha" : "cosas hechas"} note={better ? `${better} más que la anterior` : null} />
              <Tile value={`${weekPct}%`} label={isCurrent ? "de tus bloques, por ahora" : "de tus bloques"} />
              <Tile value={stats.streak_weeks} label={stats.streak_weeks === 1 ? "semana seguida" : "semanas seguidas"}
                note={stats.best_streak > stats.streak_weeks ? `Tu mejor: ${stats.best_streak}` : null} />
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.45, padding: "0 4px" }}>
              Una semana suma a la racha si cumplís la mitad de tus bloques o más. Un día malo no la corta.
            </div>
          </div>

          {empty && <div style={{ textAlign: "center", color: "var(--ink-2)", fontSize: 16, padding: "8px 16px" }}>La semana recién arranca.</div>}

          {types.length > 0 && (
            <Group header="Por categoría">
              {types.map((t, i) => {
                const meta = BLOCK_TYPE[t.type] || { icon: "", label: "Sin bloque", color: "var(--ink-3)" };
                return (
                  <Row key={t.type || "none"} divider={i > 0} style={{ display: "block" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ flex: 1 }}>{meta.icon ? `${meta.icon} ` : ""}{meta.label}</span>
                      {t.blocks_total > 0 && <span className="num" style={{ fontSize: 17, fontWeight: 600 }}>{pctOf(t.blocks_done, t.blocks_total)}%</span>}
                    </div>
                    {t.blocks_total > 0 && <Bar done={t.blocks_done} total={t.blocks_total} color={meta.color} />}
                    <div className="num" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6 }}>
                      {[t.blocks_total > 0 && `${t.blocks_done} de ${t.blocks_total} bloques`, t.done > 0 && `${t.done} ${t.done === 1 ? "cosa hecha" : "cosas hechas"}`].filter(Boolean).join(", ")}
                    </div>
                  </Row>
                );
              })}
            </Group>
          )}

          {routines.length > 0 && (
            <Group header="Rutinas">
              {routines.map((r, i) => (
                <Row key={i} divider={i > 0}>
                  <span style={{ flex: 1, minWidth: 0 }}>{r.text}</span>
                  <span className="num" style={{ fontSize: 15, color: "var(--good)", fontWeight: 600 }}>{r.done} {r.done === 1 ? "vez" : "veces"}</span>
                </Row>
              ))}
            </Group>
          )}

          <Heatmap />

          <div style={{ fontSize: 13, color: "var(--ink-2)", textAlign: "center", lineHeight: 1.6, padding: "0 8px" }}>
            {footer && <>{footer}.</>}
            {stats.pending > 0 && <><br />Para seguir: {stats.pending} cosa{stats.pending === 1 ? "" : "s"}.</>}
            {isCurrent && <><br />El domingo a las 20 te llega el resumen.</>}
          </div>
        </>}
      </div>
    </>
  );
}

const NAV_BTN = { width: 36, height: 36, borderRadius: "50%", border: "none", background: "var(--surface)", boxShadow: "var(--shadow-card)", cursor: "pointer",
  color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 };
