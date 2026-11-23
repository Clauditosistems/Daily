// Cierre del día: corto y sin culpa. Por cada pendiente: lo hice / no la hice / mañana / ahora / eliminar.
// Lo que no se toque pasa solo a mañana (el rollover de cada hora), sin aviso.
import { useState } from "react";
import { CHIP, TEXT_BTN, DANGER_BTN, CARD } from "./ui";

function Item({ task, subs = [], onAction }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const done = subs.filter(s => s.done).length;
  const run = async action => { setBusy(true); try { await onAction(task, action); } finally { setBusy(false); } };
  const btn = { ...CHIP(false), padding: "8px 12px", opacity: busy ? 0.5 : 1 };

  return (
    <div style={{ padding: "12px 0", borderTop: "0.5px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={{ fontSize: 16, lineHeight: 1.35, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{task.text}</div>
        {task.detail && <div style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{task.detail}</div>}
        {subs.length > 0 && <div className="num" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>{done} de {subs.length} hechas</div>}
      </div>
      {confirmDel ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: "var(--ink-2)" }}>¿La eliminamos?</span>
          <button onClick={() => run("delete")} disabled={busy} style={{ ...DANGER_BTN, fontSize: 15, fontWeight: 600, padding: "6px 4px" }}>Sí, eliminar</button>
          <button onClick={() => setConfirmDel(false)} style={{ ...TEXT_BTN, fontSize: 15, color: "var(--ink-2)", padding: "6px 4px" }}>No</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => run("done")} disabled={busy} style={btn}>Lo hice</button>
          <button onClick={() => run("not_done")} disabled={busy} style={btn}>No la hice</button>
          {!task.routine_id && <button onClick={() => run("tomorrow")} disabled={busy} style={btn}>Pasar a mañana</button>}
          <button onClick={() => run("now")} disabled={busy} style={btn}>Hacerla ahora</button>
          <button onClick={() => setConfirmDel(true)} disabled={busy} style={{ ...btn, color: "var(--ink-2)" }}>Eliminar</button>
        </div>
      )}
    </div>
  );
}

export default function DayClose({ items, subs = {}, doneToday = 0, onAction }) {
  if (!items.length) return null;
  return (
    <section className="view-in" style={{ ...CARD, borderRadius: 20, padding: "18px 18px 6px" }} aria-label="Cierre del día">
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Cierre del día</div>
      <div style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.5, margin: "6px 0 6px" }}>
        {doneToday > 0 ? `Hoy hiciste ${doneToday} ${doneToday === 1 ? "cosa" : "cosas"}. ` : ""}
        Si querés, decidí qué hacer con esto. Lo que no toques pasa solo a mañana.
      </div>
      {items.map(t => <Item key={t.id} task={t} subs={subs[t.id]} onAction={onAction} />)}
    </section>
  );
}
