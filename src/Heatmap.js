import { useState, useEffect } from "react";
import { fetchActivity, fetchAtypicalDays } from "./supabase";
import { parseYmd, addDays, weekDates, todayStr, CARD } from "./ui";

const WEEKS = 22;     // ~5 meses; entra en 360 px de ancho
const CELL = 11, GAP = 2;
const ROW_LABELS = ["L", "", "X", "", "V", "", ""];

// Rampa secuencial (theme.css): 0 = pista; más tareas = más oscuro (en modo oscuro, más claro).
function level(n) {
  if (!n) return "var(--surface-2)";
  if (n === 1) return "var(--heat-1)";
  if (n <= 3) return "var(--heat-2)";
  if (n <= 5) return "var(--heat-3)";
  return "var(--heat-4)";
}

const fmt = d => parseYmd(d).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });

export default function Heatmap() {
  const today = todayStr();
  const firstMonday = addDays(weekDates(today)[0], -7 * (WEEKS - 1));
  const [counts, setCounts] = useState(null);
  const [picked, setPicked] = useState(null);
  const [atypical, setAtypical] = useState([]);

  useEffect(() => {
    fetchActivity(firstMonday)
      .then(rows => setCounts(Object.fromEntries(rows.map(r => [r.day, r.done]))))
      .catch(() => setCounts({}));
    fetchAtypicalDays(firstMonday).then(setAtypical).catch(() => {});
  }, [firstMonday]);

  if (!counts) return null;

  const weeks = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(firstMonday, w * 7 + d)));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const activeDays = Object.values(counts).filter(Boolean).length;
  const shown = picked || today;

  // Etiqueta de mes donde cambia el mes, salteando las que quedarían pegadas (< 3 columnas).
  const labelCols = new Set();
  let lastCol = -Infinity;
  weeks.forEach((days, w) => {
    const month = parseYmd(days[0]).getMonth();
    const starts = w === 0 ? weeks.slice(0, 3).every(d => parseYmd(d[0]).getMonth() === month)
                           : month !== parseYmd(weeks[w - 1][0]).getMonth();
    if (starts && w - lastCol >= 3) { labelCols.add(w); lastCol = w; }
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 16px" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>Actividad</span>
        <span className="num" style={{ fontSize: 13, color: "var(--ink-2)" }}>{total} hechas en {activeDays} días</span>
      </div>
    <div style={{ ...CARD, padding: "14px 14px 12px", display: "flex", flexDirection: "column", gap: 10 }}>

      <div style={{ display: "flex", gap: GAP, overflowX: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: GAP, paddingTop: 13 }}>
          {ROW_LABELS.map((l, i) => (
            <span key={i} style={{ height: CELL, fontSize: 9, fontWeight: 500, lineHeight: `${CELL}px`, color: "var(--ink-3)", width: 9 }}>{l}</span>
          ))}
        </div>
        {weeks.map((days, w) => {
          const showMonth = labelCols.has(w);
          return (
            <div key={w} style={{ display: "flex", flexDirection: "column", gap: GAP }}>
              <span style={{ height: 11, fontSize: 9, fontWeight: 500, color: "var(--ink-3)", whiteSpace: "nowrap", width: CELL, overflow: "visible" }}>
                {showMonth ? parseYmd(days[0]).toLocaleDateString("es-AR", { month: "short" }).replace(".", "") : ""}
              </span>
              {days.map(d => {
                const future = d > today;
                const n = counts[d] || 0;
                const neutral = atypical.includes(d) && !n;  // día atípico: ni hueco ni falla
                return (
                  <button key={d} onClick={() => !future && setPicked(d)} disabled={future}
                    title={future ? "" : neutral ? `${fmt(d)} · día atípico` : `${fmt(d)} · ${n} hecha${n === 1 ? "" : "s"}`}
                    aria-label={future ? undefined : `${fmt(d)}: ${n} tareas hechas`}
                    style={{
                      width: CELL, height: CELL, padding: 0, borderRadius: 3, cursor: future ? "default" : "pointer",
                      background: future || neutral ? "transparent" : level(n),
                      border: d === shown ? "1.5px solid var(--ink)" : neutral ? "1px dashed var(--ink-3)" : "none",
                    }} />
                );
              })}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span className="num" style={{ fontSize: 13, color: "var(--ink-2)" }}>
          {atypical.includes(shown) && !counts[shown]
            ? <>{fmt(shown)}: día atípico ☾</>
            : <>{fmt(shown)}: <b style={{ color: "var(--ink)" }}>{counts[shown] || 0}</b> hecha{counts[shown] === 1 ? "" : "s"}</>}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--ink-3)" }}>
          menos
          {[0, 1, 2, 4, 6].map(n => <span key={n} style={{ width: 9, height: 9, borderRadius: 2, background: level(n) }} />)}
          más
        </span>
      </div>
    </div>
    </div>
  );
}
