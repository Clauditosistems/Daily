import { useState, useEffect } from "react";
import { fetchRoutines, createRoutine, updateRoutine, deleteRoutine } from "./supabase";
import {
  BLOCK_TYPE, TASK_TYPES, DAYS, PRIO, todayStr, hhmm,
  FIELD, LABEL, PRIMARY_BTN, GHOST_BTN, ERROR_BOX, Sheet, BlockTypePicker, PrioPicker, DayPicker, DANGER_BTN, TEXT_BTN, Group, Row, Icon, ScreenTitle, Toggle
} from "./ui";

function daysLabel(days) {
  const set = new Set(days);
  if (set.size === 7) return "Todos los días";
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return "Lunes a viernes";
  if (set.size === 2 && set.has(0) && set.has(6)) return "Fines de semana";
  return DAYS.filter(([n]) => set.has(n)).map(([, name]) => name.slice(0, 3)).join(", ");
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
        <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...FIELD, fontVariantNumeric: "tabular-nums", maxWidth: 140 }} />
      </div>
      <div>
        <div style={LABEL}>Prioridad</div>
        <PrioPicker value={prio} onChange={setPrio} />
      </div>
      {!isNew && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1, fontSize: 16 }}>Activa<span style={{ display: "block", color: "var(--ink-2)", fontSize: 13, marginTop: 2 }}>Pausada no genera tareas.</span></span>
          <Toggle label="Rutina activa" checked={active} onChange={setActive} />
        </div>
      )}
      <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
        La tarea aparece sola en la agenda los días elegidos, desde hoy. Los cambios se aplican a las tareas pendientes de hoy en adelante.
      </div>
      {error && <div style={ERROR_BOX}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {!isNew && <button onClick={remove} disabled={busy} style={DANGER_BTN}>Eliminar</button>}
        <button onClick={onClose} style={{ ...TEXT_BTN, flex: 1, color: "var(--ink-2)" }}>Cancelar</button>
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
    <>
      <ScreenTitle title="Rutinas" subtitle="Aparecen solas en la agenda los días que elijas."
        right={<button onClick={() => setSheet({})} aria-label="Nueva rutina" style={ADD_BTN}><Icon name="plus" size={20} stroke={2.2} /></button>} />
      <div className="view-in" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={ERROR_BOX}>{error}</div>}
        {loading && <div style={{ color: "var(--ink-2)", fontSize: 15, padding: 20, textAlign: "center" }}>Cargando…</div>}

        {!loading && routines.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink-2)", fontSize: 16, padding: "40px 16px", lineHeight: 1.5 }}>
            Todavía no tenés rutinas.
            <button onClick={() => setSheet({})} style={{ ...TEXT_BTN, display: "block", margin: "8px auto 0" }}>Crear la primera</button>
          </div>
        )}

        {routines.length > 0 && (
          <Group>
            {routines.map((r, i) => {
              const t = BLOCK_TYPE[r.block_type];
              const meta = [daysLabel(r.days_of_week), r.scheduled_time && hhmm(r.scheduled_time), t && `${t.icon} ${t.label}`, !r.active && "Pausada"].filter(Boolean);
              return (
                <Row key={r.id} divider={i > 0} onClick={() => setSheet({ routine: r })} chevron style={{ opacity: r.active ? 1 : 0.5 }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block" }}>
                      {r.prio === "high" && <span style={{ color: "var(--prio-high)", fontWeight: 700, marginRight: 5 }}>!!</span>}
                      {r.text}
                    </span>
                    <span className="num" style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>
                      {meta.map((m, k) => <span key={k}>{m}</span>)}
                    </span>
                  </span>
                </Row>
              );
            })}
          </Group>
        )}
      </div>

      {sheet && (
        <RoutineSheet key={sheet.routine?.id || "new"} routine={sheet.routine} onSave={handleSave} onDelete={handleDelete} onClose={() => setSheet(null)} />
      )}
    </>
  );
}

const ADD_BTN = { width: 36, height: 36, borderRadius: "50%", border: "none", background: "var(--surface)", boxShadow: "var(--shadow-card)", cursor: "pointer",
  color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 };
