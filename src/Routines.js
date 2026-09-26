import { useState, useEffect } from "react";
import { fetchRoutines, createRoutine, updateRoutine, deleteRoutine } from "./supabase";
import {
  BLOCK_TYPE, TASK_TYPES, DAYS, PRIO, todayStr, hhmm,
  FIELD, LABEL, PRIMARY_BTN, GHOST_BTN, ERROR_BOX, Sheet, BlockTypePicker, PrioPicker, DayPicker,
} from "./ui";

function daysLabel(days) {
  const set = new Set(days);
  if (set.size === 7) return "Todos los días";
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return "Lunes a viernes";
  if (set.size === 2 && set.has(0) && set.has(6)) return "Fines de semana";
  return DAYS.filter(([n]) => set.has(n)).map(([, , short]) => short).join(" · ");
}

function RoutineSheet({ routine, onSave, onDelete, onClose }) {
  const isNew = !routine;
  const [text, setText]           = useState(routine?.text || "");
  const [blockType, setBlockType] = useState(routine?.block_type ?? null);
  const [days, setDays]           = useState(routine?.days_of_week || []);
  const [prio, setPrio]           = useState(routine?.prio || "mid");
  const [active, setActive]       = useState(routine?.active ?? true);
  const [time, setTime]           = useState(hhmm(routine?.scheduled_time));
  const [error, setError]         = useState("");
  const [busy, setBusy]           = useState(false);

  const toggleDay = d => setDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);

  async function save() {
    if (!text.trim()) return setError("Escribí qué hay que hacer.");
    if (!days.length) return setError("Elegí al menos un día.");
    setBusy(true); setError("");
    try {
      await onSave({ text: text.trim(), block_type: blockType, days_of_week: [...days].sort((a, b) => a - b), prio, active, scheduled_time: time || null });
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try { await onDelete(routine.id); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Sheet title={isNew ? "Nueva rutina" : "Editar rutina"} onClose={onClose}>
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Ej: Estudiar 1h" style={FIELD} autoFocus={isNew} />
      <div>
        <div style={LABEL}>Se repite</div>
        <DayPicker value={days} onToggle={toggleDay} />
      </div>
      <div>
        <div style={LABEL}>Bloque</div>
        <BlockTypePicker value={blockType} onChange={setBlockType} allowNone types={TASK_TYPES} />
      </div>
      <div>
        <div style={LABEL}>Hora (opcional)</div>
        <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...FIELD, fontFamily: "monospace", maxWidth: 140 }} />
      </div>
      <div>
        <div style={LABEL}>Prioridad</div>
        <PrioPicker value={prio} onChange={setPrio} />
      </div>
      {!isNew && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} style={{ width: 16, height: 16 }} />
          Activa <span style={{ color: "var(--ink-3)", fontSize: 12 }}>(pausada no genera tareas)</span>
        </label>
      )}
      <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
        La tarea aparece sola en la agenda los días elegidos, desde hoy. Los cambios se aplican a las tareas pendientes de hoy en adelante.
      </div>
      {error && <div style={ERROR_BOX}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {!isNew && <button onClick={remove} disabled={busy} style={{ ...GHOST_BTN, color: "var(--bad)", borderColor: "var(--bad-border)" }}>🗑</button>}
        <button onClick={onClose} style={{ ...GHOST_BTN, flex: 1 }}>Cancelar</button>
        <button onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, flex: 2, opacity: busy ? 0.6 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </Sheet>
  );
}

export default function RoutinesView() {
  const [routines, setRoutines] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [sheet, setSheet]       = useState(null);  // { routine } o {} para nueva

  useEffect(() => {
    fetchRoutines().then(setRoutines).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);

  async function handleSave(changes) {
    const today = todayStr();
    if (sheet.routine) {
      const updated = await updateRoutine(sheet.routine.id, changes, today);
      setRoutines(p => p.map(r => r.id === updated.id ? updated : r));
    } else {
      const created = await createRoutine(changes);
      setRoutines(p => [...p, created]);
    }
  }

  async function handleDelete(id) {
    await deleteRoutine(id, todayStr());
    setRoutines(p => p.filter(r => r.id !== id));
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px 40px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, color: "var(--ink-2)", padding: "0 2px 4px" }}>Tareas que se repiten. Aparecen solas en la agenda.</div>
      {error && <div style={ERROR_BOX}>{error}</div>}
      {loading && <div style={{ color: "var(--ink-3)", fontSize: 13, padding: 20, textAlign: "center" }}>Cargando…</div>}

      {!loading && routines.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 13, padding: "30px 10px", lineHeight: 1.6 }}>
          🔁<br />Todavía no tenés rutinas.
        </div>
      )}

      {routines.map(r => {
        const t = BLOCK_TYPE[r.block_type];
        return (
          <button key={r.id} onClick={() => setSheet({ routine: r })}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "var(--surface)", border: "1.5px solid var(--border)", borderLeft: `4px solid ${t?.color || "var(--border)"}`, borderRadius: 13, padding: "10px 12px", cursor: "pointer", fontFamily: "inherit", opacity: r.active ? 1 : 0.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRIO[r.prio]?.color, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{r.text}</span>
              <span style={{ display: "block", fontFamily: "monospace", fontSize: 10, color: "var(--ink-3)", marginTop: 2 }}>
                {daysLabel(r.days_of_week)}{r.scheduled_time ? ` · ${hhmm(r.scheduled_time)}` : ""}{t ? ` · ${t.icon} ${t.label}` : ""}{r.active ? "" : " · pausada"}
              </span>
            </span>
          </button>
        );
      })}

      <button onClick={() => setSheet({})}
        style={{ background: "transparent", border: "1.5px dashed var(--border)", borderRadius: 13, padding: "10px", fontFamily: "inherit", fontSize: 13, color: "var(--ink-2)", cursor: "pointer", marginTop: 4 }}>
        + Nueva rutina
      </button>

      {sheet && (
        <RoutineSheet key={sheet.routine?.id || "new"} routine={sheet.routine} onSave={handleSave} onDelete={handleDelete} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
