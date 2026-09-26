import { useEffect, useRef } from "react";
import { BLOCK_TYPE, hhmm, toMinutes } from "./ui";
import { placeTasks, blockDone } from "./plan";

const PX = 1;           // píxeles por minuto (60 px por hora)
const GUTTER = 44;      // columna de horas
const PIN_H = 24;       // alto de una tarea con hora

// Bloques ubicados en una escala de horas, tareas con hora como marcas y línea de "ahora".
export default function Timeline({ blocks, tasks, checkins = [], isToday, onTapTask, onTapBlock }) {
  const scroller = useRef(null);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const { inBlock } = placeTasks(blocks, tasks);
  const timed = tasks.filter(t => t.scheduled_time).sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
  const untimed = tasks.filter(t => !t.scheduled_time && !t.done).length;

  // Rango visible: al menos 7 a 22, ampliado para que entren bloques, tareas y "ahora".
  const mins = [...blocks.map(b => toMinutes(b.start_time)), ...timed.map(t => toMinutes(t.scheduled_time)), isToday ? nowMin : 7 * 60];
  const maxs = [...blocks.map(b => toMinutes(b.end_time)), ...timed.map(t => toMinutes(t.scheduled_time) + 30), isToday ? nowMin + 30 : 22 * 60];
  const startH = Math.min(7, Math.floor(Math.min(...mins) / 60));
  const endH = Math.min(24, Math.max(22, Math.ceil(Math.max(...maxs) / 60)));
  const start = startH * 60;
  const height = (endH - startH) * 60 * PX;
  const y = m => (m - start) * PX;

  // Arranca mostrando la hora actual (o el primer bloque).
  useEffect(() => {
    const target = isToday ? y(nowMin) - 120 : blocks.length ? y(toMinutes(blocks[0].start_time)) - 20 : 0;
    if (scroller.current) scroller.current.scrollTop = Math.max(0, target);
  }, []);  // solo al montar

  // Tareas con hora: si se pisan, cada una baja lo justo para no taparse.
  let lastBottom = -Infinity;
  const pins = timed.map(t => {
    const top = Math.max(y(toMinutes(t.scheduled_time)) - PIN_H / 2, lastBottom + 2);
    lastBottom = top + PIN_H;
    return { t, top };
  });

  return (
    <div ref={scroller} style={{ flex: 1, overflowY: "auto", padding: "10px 12px 30px" }}>
      <div style={{ position: "relative", height, marginTop: 6 }}>
        {Array.from({ length: endH - startH + 1 }, (_, i) => startH + i).map(h => (
          <div key={h} style={{ position: "absolute", top: y(h * 60), left: 0, right: 0, display: "flex", alignItems: "center", gap: 6, pointerEvents: "none" }}>
            <span className="num" style={{ width: GUTTER - 6, textAlign: "right", fontSize: 11, fontWeight: 500, color: "var(--ink-3)", transform: "translateY(-1px)" }}>
              {String(h % 24).padStart(2, "0")}:00
            </span>
            <span style={{ flex: 1, height: 0.5, background: "var(--border)" }} />
          </div>
        ))}

        {blocks.map(b => {
          const t = BLOCK_TYPE[b.block_type] || BLOCK_TYPE.otro;
          const top = y(toMinutes(b.start_time)), h = Math.max(22, (toMinutes(b.end_time) - toMinutes(b.start_time)) * PX);
          const isNow = isToday && !b.floating && nowMin >= toMinutes(b.start_time) && nowMin < toMinutes(b.end_time);
          return (
            <button key={b.block_id} onClick={() => onTapBlock(b)}
              aria-label={`${b.label || t.label}, de ${hhmm(b.start_time)} a ${hhmm(b.end_time)}`}
              style={{
                position: "absolute", top: top + 1, height: h - 2,
                left: b.floating ? `calc(${GUTTER}px + 50%)` : GUTTER, right: 4,
                background: t.bg, border: "none", boxShadow: isNow ? "inset 0 0 0 1.5px var(--accent)" : "none",
                borderLeft: `4px ${b.floating ? "dashed" : "solid"} ${t.color}`, borderRadius: 10,
                padding: "5px 8px", textAlign: "left", cursor: "pointer", fontFamily: "inherit", color: "var(--ink)", overflow: "hidden",
                display: "flex", flexDirection: "column", alignItems: "flex-start",
              }}>
              <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                {t.icon} {b.label || t.label}
                {b.block_type !== "ocio" && blockDone(b, inBlock[b.block_id], checkins) && <span style={{ color: "var(--good)", marginLeft: 6 }}>✓</span>}
              </span>
              {h >= 40 && (
                <span className="num" style={{ fontSize: 12, color: "var(--ink-2)" }}>
                  {b.floating ? "~" : ""}{hhmm(b.start_time)}–{hhmm(b.end_time)}
                </span>
              )}
            </button>
          );
        })}

        {pins.map(({ t, top }) => (
          <button key={t.id} onClick={() => onTapTask(t)}
            style={{
              position: "absolute", top, height: PIN_H, left: GUTTER + 70, right: 10, zIndex: 2,
              display: "flex", alignItems: "center", gap: 6, padding: "0 8px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
              background: "var(--surface)", border: "none", color: t.done ? "var(--ink-3)" : "var(--ink)",
              boxShadow: "var(--shadow-float)", textAlign: "left", overflow: "hidden",
            }}>
            <span className="num" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>{hhmm(t.scheduled_time)}</span>
            <span style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: t.done ? "line-through" : "none" }}>
              {t.done ? "✓ " : ""}{t.text}
            </span>
          </button>
        ))}

        {isToday && nowMin >= start && nowMin <= endH * 60 && (
          <div style={{ position: "absolute", top: y(nowMin), left: GUTTER - 4, right: 0, zIndex: 3, pointerEvents: "none", display: "flex", alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", marginTop: -1 }} />
            <span style={{ flex: 1, height: 2, background: "var(--accent)" }} />
            <span style={{ position: "absolute", left: -GUTTER + 4, width: GUTTER - 6, textAlign: "right", fontSize: 11, fontWeight: 700, color: "var(--accent)", background: "var(--bg)" }}>
              {hhmm(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`)}
            </span>
          </div>
        )}
      </div>

      {untimed > 0 && (
        <div style={{ marginTop: 16, fontSize: 13, color: "var(--ink-2)", textAlign: "center" }}>
          {untimed} tarea{untimed === 1 ? "" : "s"} sin hora en la vista Día.
        </div>
      )}
    </div>
  );
}
