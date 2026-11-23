// Repaso: rutinas de los últimos 7 días que quedaron sin marcar.
// Por tarea: hecha / no la hice. Por día: "fue un día atípico" (el día entero deja de contar).
// Lo que no se responda queda en neutro: sin rojo, sin contadores de deuda.
import { useState, useEffect } from "react";
import { fetchReview, markDoneOn, updateTask, markPastAtypical } from "./supabase";
import { parseYmd, addDays, CHIP, TEXT_BTN, CARD, ERROR_BOX, Sheet, haptic } from "./ui";

function dayLabel(date, today) {
  if (date === addDays(today, -1)) return "Ayer";
  const s = parseYmd(date).toLocaleDateString("es-AR", { weekday: "long", day: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function useReviewCount(today, deps = []) {
  const [n, setN] = useState(0);
  useEffect(() => { fetchReview(today).then(r => setN(r.length)).catch(() => {}); }, [today, ...deps]);
  return n;
}

// Tarjeta chica que invita al repaso (en la Agenda y antes del resumen).
export function ReviewBanner({ count, onOpen, title = "Repaso de estos días", text }) {
  if (!count) return null;
  return (
    <button onClick={onOpen}
      style={{ ...CARD, display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: "var(--ink)", width: "100%" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 16, fontWeight: 600 }}>{title}</span>
        <span style={{ display: "block", fontSize: 14, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.4 }}>
          {text || `${count} ${count === 1 ? "rutina quedó" : "rutinas quedaron"} sin marcar. Si querés, contame cómo fue.`}
        </span>
      </span>
      <span style={{ fontSize: 15, color: "var(--accent)", fontWeight: 600, whiteSpace: "nowrap" }}>Repasar</span>
    </button>
  );
}

function Item({ task, onAnswer }) {
  const [busy, setBusy] = useState(false);
  const btn = { ...CHIP(false), padding: "8px 13px", opacity: busy ? 0.5 : 1 };
  const run = async a => { setBusy(true); try { await onAnswer(task, a); } finally { setBusy(false); } };
  return (
    <div style={{ padding: "11px 0", borderTop: "0.5px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={{ fontSize: 16, lineHeight: 1.35, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{task.text}</div>
        {task.detail && <div style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{task.detail}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => run("done")} disabled={busy} style={btn}>Hecha</button>
        <button onClick={() => run("not_done")} disabled={busy} style={btn}>No la hice</button>
      </div>
    </div>
  );
}

export function ReviewSheet({ today, onChanged, onClose }) {
  const [items, setItems]   = useState(null);
  const [error, setError]   = useState("");
  const [askDay, setAskDay] = useState(null);  // día para confirmar "atípico"

  useEffect(() => { fetchReview(today).then(setItems).catch(err => { setError(err.message); setItems([]); }); }, [today]);

  async function answer(task, a) {
    try {
      if (a === "done") { haptic(); await markDoneOn(task.id, task.assigned_date); }
      else await updateTask(task.id, { outcome: "not_done" });
      setItems(p => p.filter(t => t.id !== task.id));
      onChanged?.();
    } catch (err) { setError(err.message); }
  }

  async function atypical(date) {
    try {
      await markPastAtypical(date, "Marcado en el repaso");
      setItems(p => p.filter(t => t.assigned_date !== date));
      setAskDay(null);
      onChanged?.();
    } catch (err) { setError(err.message); }
  }

  const days = items ? [...new Set(items.map(t => t.assigned_date))] : [];
  return (
    <Sheet title="Repaso" onClose={onClose}>
      <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5, marginTop: -8 }}>
        Rutinas de los últimos 7 días que quedaron sin marcar. Respondé las que quieras; las demás quedan como están.
      </div>
      {error && <div style={ERROR_BOX}>{error}</div>}
      {items === null && <div style={{ color: "var(--ink-2)", fontSize: 15 }}>Cargando…</div>}
      {items && items.length === 0 && <div style={{ fontSize: 16, color: "var(--ink-2)", padding: "8px 0" }}>No queda nada por repasar.</div>}
      {days.map(d => (
        <div key={d}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 4 }}>
            <span style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{dayLabel(d, today)}</span>
            {askDay !== d && <button onClick={() => setAskDay(d)} style={{ ...TEXT_BTN, fontSize: 14, color: "var(--ink-2)", padding: "4px 0" }}>Fue un día atípico</button>}
          </div>
          {askDay === d && (
            <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 14, lineHeight: 1.45 }}>El día entero queda como atípico: sus tareas y bloques no cuentan en las métricas. No se borra nada.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => atypical(d)} style={{ ...CHIP(true), padding: "8px 13px" }}>Sí, fue atípico</button>
                <button onClick={() => setAskDay(null)} style={{ ...TEXT_BTN, fontSize: 15, color: "var(--ink-2)" }}>No</button>
              </div>
            </div>
          )}
          {items.filter(t => t.assigned_date === d).map(t => <Item key={t.id} task={t} onAnswer={answer} />)}
        </div>
      ))}
    </Sheet>
  );
}
