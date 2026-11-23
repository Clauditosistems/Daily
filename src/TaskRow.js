// Fila de tarea compartida por la Agenda, la vista Ahora y el cierre del día.
import { useState } from "react";
import { BLOCK_TYPE, hhmm, Icon } from "./ui";

// ─── TAREA ───────────────────────────────────────────────────
export function CheckCircle({ done, onClick, size = 24, label }) {
  return (
    <button onClick={onClick} aria-label={label || (done ? "Marcar pendiente" : "Marcar hecha")}
      style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, cursor: "pointer", padding: 0,
        display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", transition: "background 0.2s",
        border: done ? "none" : "1.6px solid var(--ink-3)", background: done ? "var(--good-fill)" : "transparent" }}>
      {done && <span className="check-pop" style={{ display: "flex" }}><Icon name="check" size={Math.round(size * 0.58)} stroke={3} /></span>}
    </button>
  );
}

// Progreso de subtareas: "2/3" y una barra chica. Neutro: nunca rojo.
export function SubProgress({ done, total, open, onClick }) {
  return (
    <button onClick={onClick} aria-expanded={open} aria-label={`Subtareas: ${done} de ${total} hechas. ${open ? "Ocultar" : "Ver"}`}
      style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", padding: "6px 0 0", cursor: "pointer", fontFamily: "inherit", color: "var(--ink-2)" }}>
      <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>{done}/{total}</span>
      <span style={{ width: 44, height: 4, background: "var(--surface-3)", borderRadius: 2, overflow: "hidden" }}>
        <span style={{ display: "block", width: `${Math.round((done / total) * 100)}%`, height: "100%", background: "var(--good-fill)", borderRadius: 2, transition: "width 0.4s var(--ease-spring)" }} />
      </span>
      <Icon name="down" size={15} stroke={2.2} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
    </button>
  );
}

export function TaskRow({ task, subtasks = [], onToggle, onToggleSub, onTap, showType, divider }) {
  const [open, setOpen] = useState(false);
  const t = BLOCK_TYPE[task.block_type];
  const meta = [
    task.scheduled_time && hhmm(task.scheduled_time),
    showType && t && `${t.icon} ${t.label}`,
    task.routine_id && "Se repite",
    task.outcome === "not_done" && "Quedó sin hacer",
  ].filter(Boolean);
  const muted = task.done || task.outcome === "not_done";
  const subsDone = subtasks.filter(s => s.done).length;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 0", borderTop: divider ? "0.5px solid var(--border)" : "none" }}>
      <CheckCircle done={task.done} onClick={() => onToggle(task)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <button onClick={() => onTap(task)}
          style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ display: "block", fontSize: 16, lineHeight: 1.35, whiteSpace: "pre-wrap", wordBreak: "break-word", transition: "color 0.2s",
            color: muted ? "var(--ink-3)" : "var(--ink)", textDecoration: task.done ? "line-through" : "none" }}>
            {task.prio === "high" && !task.done && <span style={{ color: "var(--prio-high)", fontWeight: 700, marginRight: 5 }}>!!</span>}
            {task.text}
          </span>
          {task.detail && (
            <span style={{ display: "block", fontSize: 14, lineHeight: 1.4, color: task.done ? "var(--ink-3)" : "var(--ink-2)", marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {task.detail}
            </span>
          )}
          {meta.length > 0 && (
            <span className="num" style={{ display: "flex", gap: 10, fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>
              {meta.map((m, i) => <span key={i}>{m}</span>)}
            </span>
          )}
        </button>
        {subtasks.length > 0 && <SubProgress done={subsDone} total={subtasks.length} open={open} onClick={() => setOpen(o => !o)} />}
        {open && (
          <div className="view-in" style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 6 }}>
            {subtasks.map(s => (
              <div key={s.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "5px 0" }}>
                <CheckCircle size={20} done={s.done} onClick={() => onToggleSub(s)} label={s.done ? `Desmarcar ${s.text}` : `Marcar ${s.text}`} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 15, lineHeight: 1.35, wordBreak: "break-word",
                  color: s.done ? "var(--ink-3)" : "var(--ink)", textDecoration: s.done ? "line-through" : "none" }}>{s.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

