import { useState, useEffect } from "react";
import { fetchMonthOverview } from "./supabase";
import { BLOCK_TYPE, parseYmd, ymd, addDays, weekDates, birthdayOn, ERROR_BOX } from "./ui";

const TYPE_ORDER = Object.keys(BLOCK_TYPE);  // cada tipo ocupa siempre la misma posición en la casilla
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

// Grilla completa: del lunes anterior al 1 hasta el domingo posterior al último día.
function monthGrid(anchor) {
  const d = parseYmd(anchor);
  const first = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  const last = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const start = weekDates(first)[0];
  const end = weekDates(last)[6];
  const days = [];
  for (let x = start; x <= end; x = addDays(x, 1)) days.push(x);
  return { days, month: d.getMonth(), from: start, to: end };
}

function TypeStrip({ types }) {
  return (
    <div style={{ display: "flex", gap: 1.5, justifyContent: "center", height: 4 }} aria-hidden="true">
      {TYPE_ORDER.map(k => (
        <span key={k} style={{ width: 5, height: 4, borderRadius: 2, background: types.includes(k) ? BLOCK_TYPE[k].color : "transparent" }} />
      ))}
    </div>
  );
}

export default function MonthView({ anchor, today, selected, birthdays, onPickDay }) {
  const { days, month, from, to } = monthGrid(anchor);
  const [data, setData]       = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchMonthOverview(from, to)
      .then(rows => { if (alive) { setData(Object.fromEntries(rows.map(r => [r.day, r]))); setError(""); } })
      .catch(err => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [from, to]);

  const bdays = {};
  const year = parseYmd(anchor).getFullYear();
  birthdays.forEach(b => {
    [year - 1, year, year + 1].forEach(y => { const d = birthdayOn(b.month, b.day, y); (bdays[d] = bdays[d] || []).push(b.name); });
  });

  const typesInMonth = TYPE_ORDER.filter(k => Object.values(data).some(r => r.block_types.includes(k)));

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px 30px" }}>
      {error && <div style={ERROR_BOX}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
        {WEEKDAYS.map(w => (
          <div key={w} style={{ textAlign: "center", fontFamily: "monospace", fontSize: 9.5, color: "var(--ink-3)", padding: "2px 0 4px" }}>{w}</div>
        ))}
        {days.map(d => {
          const r = data[d];
          const inMonth = parseYmd(d).getMonth() === month;
          const isToday = d === today, isSelected = d === selected;
          // Días pasados: solo lo hecho. Hoy y futuros: lo planificado, en neutro. Nada en rojo.
          const past = d < today;
          const planned = !past && r?.pending > 0 ? r.pending : 0;
          const done = r && d <= today ? r.done : 0;
          const names = bdays[d] || [];
          const label = [
            parseYmd(d).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }),
            planned ? `${planned} planificadas` : null,
            done ? `${done} hechas` : null,
            r?.block_types.length ? r.block_types.map(k => BLOCK_TYPE[k]?.label).join(", ") : null,
            names.length ? `cumple de ${names.join(", ")}` : null,
            r?.notes ? `${r.notes} nota${r.notes === 1 ? "" : "s"}` : null,
            r?.atypical ? "día atípico" : null,
          ].filter(Boolean).join(" · ");
          return (
            <button key={d} onClick={() => onPickDay(d)} aria-label={label} title={label}
              style={{
                minWidth: 0, height: 58, padding: "4px 2px 3px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between",
                background: r?.atypical ? "var(--surface-2)" : isSelected ? "var(--surface)" : inMonth ? "var(--surface)" : "transparent",
                border: `1.5px solid ${isToday ? "var(--ink)" : isSelected ? "var(--border)" : inMonth ? "var(--border-soft)" : "transparent"}`,
                opacity: inMonth ? 1 : 0.45, color: "var(--ink)",
              }}>
              <span style={{ fontSize: 12.5, fontWeight: isToday ? 800 : 600, lineHeight: 1 }}>{parseYmd(d).getDate()}</span>
              <TypeStrip types={r?.block_types || []} />
              <span style={{ display: "flex", alignItems: "center", gap: 1, fontSize: 9.5, lineHeight: 1, minHeight: 11, whiteSpace: "nowrap" }}>
                {done > 0 && <span style={{ fontFamily: "monospace", fontWeight: 800, color: "var(--good)" }}>✓{done}</span>}
                {planned > 0 && done === 0 && <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--ink-3)" }}>{planned}</span>}
                {names.length > 0 && <span>🎂</span>}
                {r?.notes > 0 && <span>📝</span>}
                {r?.atypical && <span>☾</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--surface)", border: "1.5px solid var(--border-soft)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        {typesInMonth.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
            {typesInMonth.map(k => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--ink-2)" }}>
                <span style={{ width: 10, height: 4, borderRadius: 2, background: BLOCK_TYPE[k].color }} />
                {BLOCK_TYPE[k].icon} {BLOCK_TYPE[k].label}
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--ink-3)", lineHeight: 1.5 }}>
          Las rayitas son los bloques del día, siempre en el mismo orden. <span style={{ color: "var(--good)", fontFamily: "monospace", fontWeight: 800 }}>✓4</span> = cosas hechas · <span style={{ fontFamily: "monospace" }}>3</span> = planificadas · 🎂 cumple · 📝 nota · ☾ atípico. Tocá un día para abrirlo.
        </div>
      </div>
    </div>
  );
}
