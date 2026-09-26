import { useState, useEffect, useRef } from "react";
import MonthView from "./MonthView";
import Timeline from "./Timeline";
import NowView from "./Now";
import { placeTasks, visibleTasks, blockDone, blockStarted, currentBlock, nowMinutes } from "./plan";
import {
  fetchBlocksForDay, fetchTasksForDate, fetchPendingCounts, createTask, updateTask, deleteTask,
  fetchRoutines, ensureRoutineTasks, rolloverMine, fetchDayOverride, markAtypical, unmarkAtypical,
  fetchCancelledBlocks, setBlockOverride, clearBlockOverride,
  makeRoutineFromTask, fetchNotesForDate, updateNote, fetchBirthdays, fetchCheckins, setCheckin,
} from "./supabase";
import {
  BLOCK_TYPE, TASK_TYPES, PRIO, hhmm, toMinutes, parseYmd, ymd, todayStr, addDays, weekDates, dayTitle, birthdayOn,
  FIELD, LABEL, CHIP, PRIMARY_BTN, GHOST_BTN, ERROR_BOX, SECTION, Sheet, BlockTypePicker, PrioPicker, DayPicker,
} from "./ui";

// ─── TIRA SEMANAL ────────────────────────────────────────────
function WeekStrip({ selected, today, counts, onSelect }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {weekDates(selected).map(d => {
        const date = parseYmd(d);
        const active = d === selected, isToday = d === today;
        return (
          <button key={d} onClick={() => onSelect(d)}
            style={{ flex: 1, minWidth: 0, padding: "6px 0 5px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
              border: `1.5px solid ${active ? "var(--ink)" : isToday ? "var(--warn)" : "transparent"}`,
              background: active ? "var(--ink)" : "transparent", color: active ? "var(--bg)" : "var(--ink)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <span style={{ fontSize: 9, fontFamily: "monospace", textTransform: "uppercase", opacity: 0.6 }}>
              {date.toLocaleDateString("es-AR", { weekday: "short" }).slice(0, 2)}
            </span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{date.getDate()}</span>
            <span style={{ height: 5, width: 5, borderRadius: "50%", background: counts[d] ? (active ? "var(--bg)" : "var(--warn)") : "transparent" }} />
          </button>
        );
      })}
    </div>
  );
}

// ─── TAREA ───────────────────────────────────────────────────
function TaskRow({ task, onToggle, onTap, showType }) {
  const t = BLOCK_TYPE[task.block_type];
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 2px" }}>
      <button onClick={() => onToggle(task)} aria-label={task.done ? "Marcar pendiente" : "Marcar hecha"}
        style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1, cursor: "pointer",
          border: `2px solid ${task.done ? "var(--good)" : PRIO[task.prio]?.color || "var(--border)"}`,
          background: task.done ? "var(--good)" : "transparent", color: "#fff", fontSize: 12, lineHeight: 1, padding: 0 }}>
        {task.done ? "✓" : ""}
      </button>
      <button onClick={() => onTap(task)}
        style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
        <span style={{ display: "block", fontSize: 14, lineHeight: 1.45, color: task.done ? "var(--ink-3)" : "var(--ink)", textDecoration: task.done ? "line-through" : "none", wordBreak: "break-word" }}>
          {task.scheduled_time && (
            <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: task.done ? "var(--ink-3)" : "var(--ink)", marginRight: 6 }}>
              {hhmm(task.scheduled_time)}
            </span>
          )}
          {task.text}
        </span>
        {(task.routine_id || (showType && t)) && (
          <span style={{ display: "flex", gap: 8, fontFamily: "monospace", fontSize: 9.5, color: "var(--ink-3)", marginTop: 2 }}>
            {showType && t && <span style={{ color: "var(--ink-2)" }}>{t.icon} {t.label}</span>}
            {task.routine_id && <span>🔁 rutina</span>}
          </span>
        )}
      </button>
    </div>
  );
}

// A partir de la tercera vez que una tarea pasa de día: partir, mover o soltar. Sin juicio.
function StuckPrompt({ task, onSplit, onMove, onRelease }) {
  const [step, setStep]   = useState(null);  // null | "split" | "move"
  const [parts, setParts] = useState(["", ""]);
  const [date, setDate]   = useState(addDays(task.assigned_date, 1));
  const [busy, setBusy]   = useState(false);
  const run = async fn => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <div style={{ background: "var(--hl-bg)", border: "1.5px solid var(--hl-border)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>Esta viene quedando para después. ¿La partimos en algo más chico, la movemos a otro día, o la soltamos?</div>
      {step === null && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setStep("split")} style={{ ...GHOST_BTN, flex: 1, padding: "9px 6px" }}>Partir</button>
          <button onClick={() => setStep("move")} style={{ ...GHOST_BTN, flex: 1, padding: "9px 6px" }}>Mover</button>
          <button onClick={() => run(onRelease)} disabled={busy} style={{ ...GHOST_BTN, flex: 1, padding: "9px 6px" }}>Soltar</button>
        </div>
      )}
      {step === "split" && (
        <>
          {parts.map((v, i) => (
            <input key={i} value={v} onChange={e => setParts(p => p.map((x, j) => j === i ? e.target.value : x))}
              placeholder={i === 0 ? "Primer paso, algo chico" : "Lo que sigue"} style={{ ...FIELD, background: "var(--surface)" }} />
          ))}
          <button onClick={() => run(() => onSplit(parts.map(x => x.trim()).filter(Boolean)))} disabled={busy || !parts[0].trim()} style={PRIMARY_BTN}>Partir en tareas</button>
        </>
      )}
      {step === "move" && (
        <>
          <input type="date" value={date} min={todayStr()} onChange={e => setDate(e.target.value)} style={{ ...FIELD, fontFamily: "monospace", background: "var(--surface)" }} />
          <button onClick={() => run(() => onMove(date))} disabled={busy || !date} style={PRIMARY_BTN}>Mover a ese día</button>
        </>
      )}
    </div>
  );
}

function TaskSheet({ task, initialBlocks, onSave, onDelete, onSplit, onClose }) {
  const isNew = !task.id;
  const [text, setText]           = useState(task.text || "");
  const [date, setDate]           = useState(task.assigned_date);
  const [blockType, setBlockType] = useState(task.block_type ?? null);
  const [prio, setPrio]           = useState(task.prio || "mid");
  const [time, setTime]           = useState(hhmm(task.scheduled_time));
  const [repeat, setRepeat]       = useState(false);
  const [repeatDays, setRepeatDays] = useState(() => [parseYmd(task.assigned_date).getDay()]);
  const [blockId, setBlockId]     = useState(task.block_id ?? null);
  const [dayBlocks, setDayBlocks] = useState(initialBlocks || []);
  const [error, setError]         = useState("");
  const [busy, setBusy]           = useState(false);

  // Bloques del día elegido, para poder atarla a uno puntual (aunque sea de otro tipo).
  useEffect(() => {
    if (date === task.assigned_date && initialBlocks) { setDayBlocks(initialBlocks); return; }
    setBlockId(null);
    if (!date) return;
    fetchBlocksForDay(date).then(setDayBlocks).catch(() => setDayBlocks([]));
  }, [date]);  // solo cuando cambia el día
  const pickable = dayBlocks.filter(b => b.block_type !== "ocio");

  const toggleRepeatDay = d => setRepeatDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);

  async function save() {
    if (!text.trim()) return setError("Escribí la tarea.");
    if (!date) return setError("Elegí una fecha.");
    if (repeat && !repeatDays.length) return setError("Elegí al menos un día para repetir.");
    const changes = { text: text.trim(), assigned_date: date, block_type: blockType, prio, scheduled_time: time || null, block_id: blockId };
    setBusy(true); setError("");
    try { await onSave(changes, repeat ? repeatDays : null); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try { await onDelete(task.id); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Sheet title={isNew ? "Nueva tarea" : "Editar tarea"} onClose={onClose}>
      {!isNew && !task.done && !task.routine_id && task.rollover_count >= 3 && (
        <StuckPrompt task={task}
          onSplit={async parts => { await onSplit(task, parts); onClose(); }}
          onMove={async d => { await onSave({ assigned_date: d, block_id: null, rollover_count: 0 }); onClose(); }}
          onRelease={async () => { await onDelete(task.id); onClose(); }} />
      )}
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} autoFocus={isNew}
        placeholder="¿Qué hay que hacer?" style={{ ...FIELD, resize: "none", lineHeight: 1.45 }} />
      <div>
        <div style={LABEL}>Día</div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...FIELD, fontFamily: "monospace" }} />
      </div>
      <div>
        <div style={LABEL}>Tipo</div>
        <BlockTypePicker value={blockType} onChange={setBlockType} allowNone types={TASK_TYPES} />
      </div>
      {pickable.length > 0 && (
        <div>
          <div style={LABEL}>Bloque de ese día</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setBlockId(null)} style={CHIP(blockId === null)}>Según el tipo</button>
            {pickable.map(b => {
              const bt = BLOCK_TYPE[b.block_type] || BLOCK_TYPE.otro;
              return (
                <button key={b.block_id} onClick={() => setBlockId(b.block_id)} style={CHIP(blockId === b.block_id, bt.color, bt.bg)}>
                  {bt.icon} {b.label || bt.label} {hhmm(b.start_time)}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <div style={LABEL}>Hora (opcional)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...FIELD, fontFamily: "monospace", maxWidth: 140 }} />
          {time && <button onClick={() => setTime("")} style={{ ...GHOST_BTN, padding: "8px 12px" }}>Sin hora</button>}
        </div>
        {time && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 5 }}>Te llega un aviso a esa hora.</div>}
      </div>
      <div>
        <div style={LABEL}>Prioridad</div>
        <PrioPicker value={prio} onChange={setPrio} />
      </div>
      {task.routine_id
        ? <div style={{ fontSize: 12, color: "var(--ink-3)" }}>🔁 Esta tarea viene de una rutina. Los cambios aplican solo a este día; la rutina se edita en la pestaña Rutinas.</div>
        : (
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
              <input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} style={{ width: 16, height: 16 }} />
              🔁 Repetir (convertir en rutina)
            </label>
            {repeat && (
              <div style={{ marginTop: 10 }}>
                <DayPicker value={repeatDays} onToggle={toggleRepeatDay} />
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6 }}>Va a aparecer sola esos días, desde hoy.</div>
              </div>
            )}
          </div>
        )}
      {error && <div style={ERROR_BOX}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {!isNew && <button onClick={remove} disabled={busy} style={{ ...GHOST_BTN, color: "var(--bad)", borderColor: "var(--bad-border)" }}>🗑</button>}
        <button onClick={onClose} style={{ ...GHOST_BTN, flex: 1 }}>Cancelar</button>
        <button onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, flex: 2, opacity: busy ? 0.6 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </Sheet>
  );
}

// ─── BLOQUE ──────────────────────────────────────────────────
function BlockCard({ block, tasks, isNow, started, done, onAdd, onEditDay, onToggle, onTap, onCheckin }) {
  const t = BLOCK_TYPE[block.block_type] || BLOCK_TYPE.otro;
  const isOcio = block.block_type === "ocio";
  return (
    <div style={{ background: "var(--surface)", border: `1.5px solid ${isNow ? t.color : "var(--border)"}`, borderLeft: `5px ${block.floating ? "dashed" : "solid"} ${t.color}`, borderRadius: 15, padding: "10px 12px 6px" }}>
      <button onClick={() => onEditDay(block)} aria-label="Opciones de este bloque para este día"
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", color: "inherit", textAlign: "left" }}>
        <span style={{ fontSize: 16 }}>{t.icon}</span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{block.label || t.label}</span>
        {isNow && <span style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 700, color: "var(--bg)", background: "var(--ink)", borderRadius: 6, padding: "2px 6px" }}>AHORA</span>}
        {!isOcio && done && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--good)" }}>✓ Cumplido</span>}
        <span style={{ fontFamily: "monospace", fontSize: 11, color: block.overridden ? "var(--warn)" : "var(--ink-2)", fontWeight: block.overridden ? 700 : 400 }}>
          {block.overridden ? "✎ " : ""}{block.floating ? "~" : ""}{hhmm(block.start_time)}–{hhmm(block.end_time)}
        </span>
      </button>
      {isOcio ? (
        <div style={{ fontSize: 13, color: "var(--ink-2)", padding: "6px 0 6px" }}>Tiempo libre. Está en el plan.</div>
      ) : <>
        <div style={{ marginTop: 4 }}>
          {tasks.map(task => <TaskRow key={task.id} task={task} onToggle={onToggle} onTap={onTap} />)}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 0" }}>
          <button onClick={() => onAdd(block)}
            style={{ background: "none", border: "none", color: "var(--ink-2)", fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "6px 0" }}>
            + Tarea
          </button>
          {started && !done && (
            <button onClick={() => onCheckin(block, true)}
              style={{ background: "none", border: "none", color: "var(--good)", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "6px 0" }}>
              ✓ Estuve
            </button>
          )}
        </div>
      </>}
    </div>
  );
}

// ─── CAMBIAR UN BLOQUE SOLO ESE DÍA ──────────────────────────
function BlockDaySheet({ block, date, started, checked, onCheckin, onDone, onClose }) {
  const t = BLOCK_TYPE[block.block_type] || BLOCK_TYPE.otro;
  const isOcio = block.block_type === "ocio";
  const [confirmOcio, setConfirmOcio] = useState(false);
  const [start, setStart] = useState(hhmm(block.start_time));
  const [end, setEnd]     = useState(hhmm(block.end_time) === "24:00" ? "00:00" : hhmm(block.end_time));
  const [error, setError] = useState("");
  const [busy, setBusy]   = useState(false);

  async function run(action) {
    setBusy(true); setError("");
    try { await action(); onDone(); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  function saveTime() {
    const endDb = end === "00:00" ? "24:00" : end;
    if (toMinutes(endDb) <= toMinutes(start)) return setError("El horario de fin tiene que ser posterior al de inicio.");
    run(() => setBlockOverride(block.block_id, date, { start_time: start, end_time: endDb }));
  }

  return (
    <Sheet title={`${t.icon} ${block.label || t.label} · solo ${dayTitle(date).toLowerCase()}`} onClose={onClose}>
      {!isOcio && started && (
        <button onClick={() => run(() => onCheckin(block, !checked))} disabled={busy}
          style={{ ...GHOST_BTN, color: checked ? "var(--ink-2)" : "var(--good)", borderColor: checked ? "var(--border)" : "var(--good)", fontWeight: 700 }}>
          {checked ? "Quitar \"✓ Estuve\"" : "✓ Estuve en este bloque"}
        </button>
      )}
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>Estos cambios aplican solo a este día. Tu semana tipo no se toca.</div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={LABEL}>Desde</div>
          <input type="time" value={start} onChange={e => setStart(e.target.value)} style={{ ...FIELD, fontFamily: "monospace" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={LABEL}>Hasta</div>
          <input type="time" value={end} onChange={e => setEnd(e.target.value)} style={{ ...FIELD, fontFamily: "monospace" }} />
        </div>
      </div>
      {error && <div style={ERROR_BOX}>{error}</div>}
      <button onClick={saveTime} disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.6 : 1 }}>Cambiar horario este día</button>
      {isOcio && confirmOcio && (
        <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5 }}>El ocio también es parte del plan, ¿seguro?</div>
      )}
      <button onClick={() => (isOcio && !confirmOcio ? setConfirmOcio(true) : run(() => setBlockOverride(block.block_id, date, { cancelled: true })))} disabled={busy}
        style={{ ...GHOST_BTN, color: "var(--ink-2)" }}>
        {isOcio && confirmOcio ? "Sí, cancelarlo este día" : "Cancelar el bloque este día"}
      </button>
      {block.overridden && (
        <button onClick={() => run(() => clearBlockOverride(block.block_id, date))} disabled={busy} style={GHOST_BTN}>Volver al horario normal</button>
      )}
    </Sheet>
  );
}

// ─── MARCAR DÍA ATÍPICO ──────────────────────────────────────
function AtypicalSheet({ date, onDone, onClose }) {
  const [note, setNote]   = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy]   = useState(false);

  async function save() {
    setBusy(true); setError("");
    try { const moved = await markAtypical(date, note.trim()); onDone(moved); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Sheet title={`Día atípico · ${dayTitle(date)}`} onClose={onClose}>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Motivo (opcional): feriado, enfermo, viaje…" style={FIELD} maxLength={120} autoFocus />
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
        Se cancelan todos los bloques de este día. Las tareas pendientes pasan al próximo bloque de su tipo (las que no tienen tipo, al día siguiente). Las tareas de rutinas de este día se borran.
      </div>
      {error && <div style={ERROR_BOX}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={{ ...GHOST_BTN, flex: 1 }}>Cancelar</button>
        <button onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, flex: 2, opacity: busy ? 0.6 : 1 }}>{busy ? "Guardando…" : "Marcar atípico"}</button>
      </div>
    </Sheet>
  );
}

// ─── BARRA PARA AGREGAR RÁPIDO ───────────────────────────────
function Composer({ types, onAdd }) {
  const [text, setText] = useState("");
  const [blockType, setBlockType] = useState(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await onAdd(text.trim(), blockType); setText(""); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg)", padding: "8px 12px calc(10px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 7 }}>
      {types.length > 0 && (
        <div style={{ display: "flex", gap: 5, overflowX: "auto", scrollbarWidth: "none" }}>
          <BlockTypePicker value={blockType} onChange={setBlockType} allowNone types={types} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Agregar tarea a este día…" style={{ ...FIELD, background: "var(--surface)" }} />
        <button onClick={send} disabled={busy} aria-label="Agregar"
          style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "var(--ink)", color: "var(--bg)", fontSize: 16, cursor: "pointer", flexShrink: 0, opacity: busy ? 0.6 : 1 }}>↑</button>
      </div>
    </div>
  );
}

// ─── VISTA PRINCIPAL ─────────────────────────────────────────
const MODES = [["ahora", "Ahora"], ["dia", "Día"], ["linea", "Línea"], ["mes", "Mes"]];

const monthTitle = s => {
  const d = parseYmd(s), m = d.toLocaleDateString("es-AR", { month: "long" });
  return `${m.charAt(0).toUpperCase()}${m.slice(1)} ${d.getFullYear()}`;
};

const firstOfMonth = (s, n = 0) => { const d = parseYmd(s); return ymd(new Date(d.getFullYear(), d.getMonth() + n, 1)); };

// Antes de la primera: "7 cosas para hoy". Después: lo hecho, en positivo. Nunca "0 de 7".
function DayProgress({ tasks }) {
  if (!tasks.length) return null;
  const done = tasks.filter(t => t.done).length;
  if (done === 0) {
    return <div style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--ink-2)", textAlign: "center" }}>{tasks.length} cosa{tasks.length === 1 ? "" : "s"} para hoy</div>;
  }
  const pct = Math.round((done / tasks.length) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div role="img" aria-label={`${done} hechas`} style={{ flex: 1, height: 6, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--good)", borderRadius: 4, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--good)", fontWeight: 700, whiteSpace: "nowrap" }}>
        {done === tasks.length ? "✓ todo hecho" : `${done} hecha${done === 1 ? "" : "s"} ✓`}
      </span>
    </div>
  );
}

export default function AgendaView({ forceMode }) {
  const today = todayStr();
  const [selected, setSelected] = useState(today);
  // null hasta la primera carga: abre en "Ahora" si hay un bloque en curso, si no en "Día".
  const [mode, setModeState]    = useState(forceMode?.mode || null);
  const [checkins, setCheckins] = useState([]);
  const [monthAnchor, setMonthAnchor] = useState(() => firstOfMonth(today));
  const [routines, setRoutines] = useState(null);
  const [blocks, setBlocks]     = useState([]);
  const [tasks, setTasks]       = useState([]);
  const [dayOverride, setDayOverride] = useState(null);
  const [cancelled, setCancelled]     = useState([]);
  const [reloadKey, setReloadKey]     = useState(0);
  const [notice, setNotice]           = useState("");
  const [dayNotes, setDayNotes]       = useState([]);
  const [birthdays, setBirthdays]     = useState([]);
  const [counts, setCounts]     = useState({});
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [sheet, setSheet]       = useState(null);  // tarea existente o borrador
  const [blockSheet, setBlockSheet]       = useState(null);
  const [atypicalSheet, setAtypicalSheet] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    // Primero el rollover, así la agenda ya muestra las tareas pasadas en su nuevo día.
    rolloverMine().catch(err => setError(err.message))
      .then(fetchRoutines).then(r => setRoutines(r || []))
      .catch(err => { setError(err.message); setRoutines([]); });
    fetchBirthdays().then(setBirthdays).catch(() => {});
  }, []);

  useEffect(() => {
    if (!routines) return;
    const id = ++requestId.current;
    const week = weekDates(selected);
    setLoading(true);
    (async () => {
      try {
        await ensureRoutineTasks(routines, week, today);
        const [b, t, c, o, x, n, k] = await Promise.all([
          fetchBlocksForDay(selected),
          fetchTasksForDate(selected),
          fetchPendingCounts(week[0], week[6]),
          fetchDayOverride(selected),
          fetchCancelledBlocks(selected),
          fetchNotesForDate(selected),
          fetchCheckins(selected),
        ]);
        if (id !== requestId.current) return;  // el usuario ya cambió de día
        setBlocks(b); setTasks(t); setCounts(c); setDayOverride(o); setCancelled(x); setDayNotes(n); setCheckins(k); setError("");
        if (selected === today) setModeState(m => m ?? (!o && currentBlock(b.filter(z => !z.floating), nowMinutes()) ? "ahora" : "dia"));
      } catch (err) {
        if (id === requestId.current) setError(err.message);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    })();
  }, [selected, routines, today, reloadKey]);

  useEffect(() => { setNotice(""); }, [selected]);
  const reload = () => setReloadKey(k => k + 1);

  function setMode(m) {
    setModeState(m);
    if (m === "mes") setMonthAnchor(firstOfMonth(selected));
    if (m === "ahora") setSelected(today);
  }

  // Tocar un aviso con la app abierta puede pedir un modo (ej. "ahora").
  useEffect(() => { if (forceMode) setMode(forceMode.mode); }, [forceMode?.n]);  // solo cuando llega uno nuevo

  function pickDay(d) { setSelected(d); setMode("dia"); }

  async function refreshCounts() {
    const week = weekDates(selected);
    setCounts(await fetchPendingCounts(week[0], week[6]));
  }

  // Aplica una tarea actualizada a las listas visibles.
  function applyTask(updated) {
    setTasks(p => {
      const rest = p.filter(t => t.id !== updated.id);
      return updated.assigned_date === selected ? [...rest, updated] : rest;
    });
  }

  async function toggle(task) {
    try { applyTask(await updateTask(task.id, { done: !task.done })); refreshCounts(); }
    catch (err) { setError(err.message); }
  }

  async function saveTask(changes, repeatDays) {
    let saved = sheet.id ? await updateTask(sheet.id, changes) : await createTask(changes);
    if (repeatDays) {
      const { routine, task } = await makeRoutineFromTask(saved, repeatDays);
      saved = task;
      setRoutines(p => [...p, routine]);  // recarga y genera las próximas instancias
    }
    applyTask(saved);
    refreshCounts();
  }

  async function checkin(block, on) {
    try {
      await setCheckin(block.block_id, selected, on);
      setCheckins(p => on ? [...p, block.block_id] : p.filter(x => x !== block.block_id));
    } catch (err) { setError(err.message); }
  }

  // Partir una tarea que se viene pasando en otras más chicas (arrancan de cero).
  async function splitTask(task, parts) {
    const created = await Promise.all(parts.map(text => createTask({
      text, assigned_date: task.assigned_date, block_type: task.block_type, block_id: task.block_id, prio: task.prio,
    })));
    await deleteTask(task.id);
    setTasks(p => [...p.filter(t => t.id !== task.id), ...created.filter(c => c.assigned_date === selected)]);
    refreshCounts();
  }

  async function removeTask(id) {
    await deleteTask(id);
    setTasks(p => p.filter(t => t.id !== id));
    refreshCounts();
  }

  async function quickAdd(text, blockType) {
    try {
      const saved = await createTask({ text, assigned_date: selected, block_type: blockType });
      applyTask(saved);
      refreshCounts();
    } catch (err) { setError(err.message); }
  }

  async function archiveNote(note) {
    try { await updateNote(note.id, { archived: true }); setDayNotes(p => p.filter(n => n.id !== note.id)); }
    catch (err) { setError(err.message); }
  }

  async function undoAtypical() {
    try { await unmarkAtypical(dayOverride.id); setNotice(""); reload(); }
    catch (err) { setError(err.message); }
  }

  async function restoreBlock(blockId) {
    try { await clearBlockOverride(blockId, selected); reload(); }
    catch (err) { setError(err.message); }
  }

  const shownTasks = visibleTasks(tasks, today);
  const { inBlock, loose } = placeTasks(blocks, shownTasks);
  const nowMin = nowMinutes();
  const typesToday = [...new Set(blocks.map(b => b.block_type))].filter(k => k !== "ocio");
  const isToday = selected === today;
  const year = parseYmd(selected).getFullYear();
  const dayBirthdays = birthdays.filter(b => birthdayOn(b.month, b.day, year) === selected);

  return (
    <>
      <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div role="tablist" aria-label="Vista de la agenda" style={{ display: "flex", background: "var(--surface-2)", borderRadius: 10, padding: 3 }}>
          {MODES.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
              style={{ flex: 1, padding: "5px 0", border: "none", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: 12,
                fontWeight: mode === k ? 700 : 500, background: mode === k ? "var(--surface)" : "transparent",
                color: mode === k ? "var(--ink)" : "var(--ink-2)", boxShadow: mode === k ? "0 1px 2px rgba(0,0,0,0.12)" : "none" }}>
              {label}
            </button>
          ))}
        </div>
        {mode === "ahora" ? null : mode === "mes" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setMonthAnchor(firstOfMonth(monthAnchor, -1))} aria-label="Mes anterior" style={NAV_BTN}>‹</button>
            <div style={{ flex: 1, textAlign: "center", fontWeight: 800, fontSize: 15 }}>{monthTitle(monthAnchor)}</div>
            <button onClick={() => setMonthAnchor(firstOfMonth(monthAnchor, 1))} aria-label="Mes siguiente" style={NAV_BTN}>›</button>
          </div>
        ) : <>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setSelected(addDays(selected, -1))} aria-label="Día anterior" style={NAV_BTN}>‹</button>
          <div style={{ flex: 1, textAlign: "center", fontWeight: 800, fontSize: 15 }}>{dayTitle(selected)}</div>
          <button onClick={() => setSelected(addDays(selected, 1))} aria-label="Día siguiente" style={NAV_BTN}>›</button>
        </div>
        <WeekStrip selected={selected} today={today} counts={counts} onSelect={setSelected} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 16 }}>
          <button onClick={() => setSelected(addDays(selected, -7))} style={LINK_BTN}>‹ semana</button>
          {!isToday && <button onClick={() => setSelected(today)} style={{ ...LINK_BTN, fontWeight: 700, color: "var(--warn)" }}>Volver a hoy</button>}
          {!dayOverride && selected >= today && (
            <button onClick={() => setAtypicalSheet(true)} style={LINK_BTN}>☾ día atípico</button>
          )}
          <button onClick={() => setSelected(addDays(selected, 7))} style={LINK_BTN}>semana ›</button>
        </div>
        <DayProgress tasks={shownTasks} />
        </>}
        {mode === "mes" && firstOfMonth(today) !== monthAnchor && (
          <button onClick={() => setMonthAnchor(firstOfMonth(today))} style={{ ...LINK_BTN, alignSelf: "center", fontWeight: 700, color: "var(--warn)" }}>Volver a este mes</button>
        )}
      </div>

      {mode === "ahora" && (
        <NowView blocks={blocks} tasks={shownTasks} checkins={checkins} dayOverride={dayOverride} today={today} loading={loading}
          onToggle={toggle} onCheckin={checkin} />
      )}

      {mode === null && <div style={{ flex: 1, textAlign: "center", color: "var(--ink-3)", fontSize: 13, padding: 30 }}>Cargando…</div>}

      {mode === "mes" && (
        <MonthView anchor={monthAnchor} today={today} selected={selected} birthdays={birthdays} onPickDay={pickDay} />
      )}

      {mode === "linea" && (
        <Timeline key={`timeline-${selected}`} blocks={blocks} tasks={shownTasks} checkins={checkins} isToday={isToday} onTapTask={setSheet} onTapBlock={setBlockSheet} />
      )}

      {mode === "dia" && (

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 24px", display: "flex", flexDirection: "column", gap: 10, opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
        {error && <div style={ERROR_BOX}>{error}</div>}

        {(dayBirthdays.length > 0 || dayNotes.length > 0) && (
          <div style={{ background: "var(--hl-bg)", border: "1.5px solid var(--hl-border)", borderRadius: 15, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            {dayBirthdays.map(b => (
              <div key={b.id} style={{ fontSize: 14 }}>
                🎂 <b>Cumple de {b.name}</b>
                {b.year && <span style={{ color: "var(--ink-3)" }}> · {year - b.year} años</span>}
              </div>
            ))}
            {dayNotes.map(n => (
              <div key={n.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14 }}>
                <span>📝</span>
                <span style={{ flex: 1, wordBreak: "break-word" }}>
                  {n.remind_time && <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, marginRight: 6 }}>{hhmm(n.remind_time)}</span>}
                  {n.text}
                </span>
                <button onClick={() => archiveNote(n)} style={{ ...LINK_BTN, color: "var(--good)", fontWeight: 700 }}>✓ listo</button>
              </div>
            ))}
          </div>
        )}

        {notice && <div style={{ background: "var(--good-bg)", color: "var(--good)", borderRadius: 10, padding: "9px 12px", fontSize: 12.5 }}>{notice}</div>}

        {dayOverride && (
          <div style={{ background: "var(--surface-2)", border: "1.5px dashed var(--ink-3)", borderRadius: 15, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>☾</span>
            <span style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}>
              <b>Día atípico</b>{dayOverride.note ? `: ${dayOverride.note}` : ""}
              <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)" }}>Sin bloques. Las tareas que se movieron no vuelven solas.</span>
            </span>
            <button onClick={undoAtypical} style={{ ...LINK_BTN, color: "var(--ink)", fontWeight: 700 }}>Deshacer</button>
          </div>
        )}

        {cancelled.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {cancelled.map(c => {
              const wb = c.weekly_blocks, t = BLOCK_TYPE[wb?.block_type] || BLOCK_TYPE.otro;
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-3)", padding: "0 4px" }}>
                  <span style={{ textDecoration: "line-through", flex: 1 }}>{t.icon} {wb?.label || t.label} {hhmm(wb?.start_time)}–{hhmm(wb?.end_time)}</span>
                  <span>cancelado</span>
                  <button onClick={() => restoreBlock(c.block_id)} style={{ ...LINK_BTN, color: "var(--ink)" }}>Restaurar</button>
                </div>
              );
            })}
          </div>
        )}

        {!loading && !dayOverride && blocks.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 13, padding: "18px 10px", lineHeight: 1.6 }}>
            No hay bloques este día.<br /><span style={{ fontSize: 11.5 }}>Los configurás tocando "Daily" arriba a la izquierda.</span>
          </div>
        )}

        {blocks.map(b => (
          <BlockCard key={b.block_id} block={b} tasks={inBlock[b.block_id]}
            isNow={isToday && !b.floating && nowMin >= toMinutes(b.start_time) && nowMin < toMinutes(b.end_time)}
            started={blockStarted(b, selected, today, nowMin)}
            done={blockDone(b, inBlock[b.block_id], checkins)}
            onCheckin={checkin}
            onAdd={block => setSheet({ assigned_date: selected, block_type: block.block_type, block_id: block.block_id, prio: "mid" })}
            onEditDay={setBlockSheet}
            onToggle={toggle} onTap={setSheet} />
        ))}

        {loose.length > 0 && (
          <div style={{ background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 15, padding: "10px 12px 6px" }}>
            <div style={{ ...SECTION, color: "var(--ink-2)", padding: 0 }}>Sin bloque</div>
            {loose.map(t => <TaskRow key={t.id} task={t} onToggle={toggle} onTap={setSheet} showType />)}
          </div>
        )}
      </div>

      )}

      {(mode === "dia" || mode === "linea") && <Composer key={`composer-${selected}`} types={typesToday} onAdd={quickAdd} />}

      {sheet && (
        <TaskSheet key={sheet.id || "new"} task={sheet} initialBlocks={sheet.assigned_date === selected ? blocks : null}
          onSave={saveTask} onDelete={removeTask} onSplit={splitTask} onClose={() => setSheet(null)} />
      )}
      {blockSheet && (
        <BlockDaySheet block={blockSheet} date={selected} started={blockStarted(blockSheet, selected, today, nowMin)}
          checked={checkins.includes(blockSheet.block_id)} onCheckin={checkin}
          onDone={() => {}} onClose={() => { setBlockSheet(null); reload(); }} />
      )}
      {atypicalSheet && (
        <AtypicalSheet date={selected} onClose={() => setAtypicalSheet(false)}
          onDone={moved => { setNotice(moved ? `Se movieron ${moved} tarea${moved === 1 ? "" : "s"} a su próximo bloque.` : ""); reload(); }} />
      )}
    </>
  );
}

const NAV_BTN = { width: 34, height: 34, borderRadius: "50%", border: "1.5px solid var(--border)", background: "transparent", fontSize: 18, lineHeight: 1, cursor: "pointer", color: "var(--ink)", fontFamily: "inherit" };
const LINK_BTN = { background: "none", border: "none", padding: "2px 4px", fontFamily: "inherit", fontSize: 11.5, color: "var(--ink-3)", cursor: "pointer", whiteSpace: "nowrap" };
