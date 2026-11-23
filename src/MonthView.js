import { parseYmd, ymd, addDays, weekDates, hhmm, CARD, TEXT_BTN, Icon } from "./ui";
import { calendarItems, itemIcon } from "./Events";

// Mes: SOLO eventos (cumpleaños, planes, citas) con un marcador mínimo.
// Las tareas y la rutina no aparecen acá: se ven al entrar a un día.
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

function monthGrid(anchor) {
  const d = parseYmd(anchor);
  const first = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
  const last = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const start = weekDates(first)[0];
  const end = weekDates(last)[6];
  const days = [];
  for (let x = start; x <= end; x = addDays(x, 1)) days.push(x);
  return { days, month: d.getMonth(), from: start, to: end, first, last };
}

const dayName = s => { const t = parseYmd(s).toLocaleDateString("es-AR", { weekday: "short", day: "numeric" }).replace(".", ""); return t.charAt(0).toUpperCase() + t.slice(1); };

export default function MonthView({ anchor, today, selected, events, birthdays, plans, onPickDay, onAddEvent, onOpenItem }) {
  const { days, month, from, to, first, last } = monthGrid(anchor);
  const items = calendarItems({ events, birthdays, plans }, from, to);
  const byDay = {};
  items.forEach(it => { (byDay[it.date] = byDay[it.date] || []).push(it); });
  const inMonth = items.filter(it => it.date >= first && it.date <= last);

  return (
    <div className="view-in" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 30px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...CARD, padding: "10px 6px", display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {WEEKDAYS.map(w => (
          <div key={w} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--ink-3)", padding: "2px 0 6px" }}>{w}</div>
        ))}
        {days.map(d => {
          const list = byDay[d] || [];
          const isIn = parseYmd(d).getMonth() === month;
          const isToday = d === today, isSelected = d === selected;
          const label = [parseYmd(d).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }), ...list.map(i => i.title)].join(" · ");
          return (
            <button key={d} onClick={() => onPickDay(d)} aria-label={label} title={label}
              style={{ minWidth: 0, height: 50, padding: "4px 0", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", border: "none",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                background: isSelected && !isToday ? "var(--accent-soft)" : "transparent", opacity: isIn ? 1 : 0.35, color: "var(--ink)" }}>
              <span className="num" style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 15, fontWeight: isToday ? 700 : 500, background: isToday ? "var(--accent)" : "transparent", color: isToday ? "#fff" : "var(--ink)" }}>
                {parseYmd(d).getDate()}
              </span>
              <span aria-hidden="true" style={{ display: "flex", gap: 3, height: 5 }}>
                {list.slice(0, 3).map((it, i) => <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }} />)}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "0 4px" }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>Este mes</span>
          <button onClick={() => onAddEvent(selected >= first && selected <= last ? selected : (today >= first && today <= last ? today : first))}
            style={{ ...TEXT_BTN, fontSize: 15, display: "flex", alignItems: "center", gap: 4, padding: "2px 0" }}>
            <Icon name="plus" size={17} stroke={2.2} /> Evento
          </button>
        </div>
        <div style={{ ...CARD, overflow: "hidden" }}>
          {inMonth.length === 0 && <div style={{ padding: "14px 16px", fontSize: 15, color: "var(--ink-2)" }}>No hay eventos este mes.</div>}
          {inMonth.map((it, i) => (
            <button key={`${it.kind}-${it.id}-${it.date}`} onClick={() => onOpenItem(it)}
              style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 16px", border: "none", background: "none", textAlign: "left",
                fontFamily: "inherit", color: "var(--ink)", cursor: "pointer", boxShadow: i ? "inset 16px 0.5px 0 0 var(--surface), inset 0 0.5px 0 0 var(--border)" : "none" }}>
              <span className="num" style={{ width: 52, flexShrink: 0, fontSize: 13, color: it.date === today ? "var(--accent)" : "var(--ink-2)", fontWeight: it.date === today ? 700 : 500 }}>{dayName(it.date)}</span>
              <span style={{ fontSize: 17 }}>{itemIcon(it.kind)}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 16, lineHeight: 1.35, wordBreak: "break-word" }}>
                {it.title}{it.turns ? <span style={{ color: "var(--ink-2)" }}> · {it.turns}</span> : null}
              </span>
              {it.time && <span className="num" style={{ fontSize: 14, color: "var(--ink-2)" }}>{hhmm(it.time)}</span>}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5, padding: "0 4px" }}>
          El calendario muestra solo eventos. Tocá un día para ver sus tareas.
        </div>
      </div>
    </div>
  );
}
