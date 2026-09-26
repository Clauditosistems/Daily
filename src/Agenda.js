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
  BLOCK_TYPE, TASK_TYPES, PRIO, haptic, hhmm, toMinutes, parseYmd, ymd, todayStr, addDays, weekDates, dayTitle, birthdayOn,
  FIELD, LABEL, CHIP, PRIMARY_BTN, GHOST_BTN, TEXT_BTN, ERROR_BOX, SECTION, CARD, LARGE_TITLE, Icon, Toggle,
  Sheet, BlockTypePicker, PrioPicker, DayPicker, DANGER_BTN
} from "./ui";

// ─── TIRA SEMANAL ────────────────────────────────────────────
function WeekStrip({ selected, today, counts, onSelect }) {
  const letters = ["D", "L", "M", "X", "J", "V", "S"];
  return (
    <div style={{ display: "flex" }}>
      {weekDates(selected).map(d => {
        const date = parseYmd(d);
        const active = d === selected, isToday = d === today;
        return (
          <button key={d} onClick={() => onSelect(d)} aria-pressed={active}
            aria-label={date.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
            style={{ flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontFamily: "inherit",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: isToday ? "var(--accent)" : "var(--ink-3)" }}>{letters[date.getDay()]}</span>
            <span className="num" style={{ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 17, fontWeight: active || isToday ? 700 : 500, transition: "background 0.2s, color 0.2s",
              background: active ? (isToday ? "var(--accent)" : "var(--ink)") : "transparent",
              color: active ? (isToday ? "#fff" : "var(--bg)") : isToday ? "var(--accent)" : "var(--ink)" }}>
              {date.getDate()}
            </span>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: counts[d] && !active ? "var(--ink-3)" : "transparent" }} />
          </button>
        );
      })}
    </div>
  );
}

// ─── TAREA ───────────────────────────────────────────────────
function TaskRow({ task, onToggle, onTap, showType, divider }) {
  const t = BLOCK_TYPE[task.block_type];
  const meta = [
    task.scheduled_time && hhmm(task.scheduled_time),
    showType && t && `${t.icon} ${t.label}`,
    task.routine_id && "Se repite",
  ].filter(Boolean);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 0", borderTop: divider ? "0.5px solid var(--border)" : "none" }}>
      <button onClick={() => onToggle(task)} aria-label={task.done ? "Marcar pendiente" : "Marcar hecha"}
        style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, cursor: "pointer", padding: 0, marginTop: 0,
          display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", transition: "background 0.2s",
          border: task.done ? "none" : "1.6px solid var(--ink-3)", background: task.done ? "var(--good-fill)" : "transparent" }}>
        {task.done && <span className="check-pop" style={{ display: "flex" }}><Icon name="check" size={14} stroke={3} /></span>}
      </button>
      <button onClick={() => onTap(task)}
        style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
        <span style={{ display: "block", fontSize: 16, lineHeight: 1.35, wordBreak: "break-word", transition: "color 0.2s",
          color: task.done ? "var(--ink-3)" : "var(--ink)", textDecoration: task.done ? "line-through" : "none" }}>
          {task.prio === "high" && !task.done && <span style={{ color: "var(--prio-high)", fontWeight: 700, marginRight: 5 }}>!!</span>}
          {task.text}
        </span>
        {meta.length > 0 && (
          <span className="num" style={{ display: "flex", gap: 10, fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>
            {meta.map((m, i) => <span key={i}>{m}</span>)}
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
          <input type="date" value={date} min={todayStr()} onChange={e => setDate(e.target.value)} style={{ ...FIELD, fontVariantNumeric: "tabular-nums", background: "var(--surface)" }} />
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
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...FIELD, fontVariantNumeric: "tabular-nums" }} />
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
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...FIELD, fontVariantNumeric: "tabular-nums", maxWidth: 140 }} />
          {time && <button onClick={() => setTime("")} style={{ ...GHOST_BTN, padding: "8px 12px" }}>Sin hora</button>}
        </div>
        {time && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 5 }}>Te llega un aviso a esa hora.</div>}
      </div>
      <div>
        <div style={LABEL}>Prioridad</div>
        <PrioPicker value={prio} onChange={setPrio} />
      </div>
      {task.routine_id
        ? <div style={{ fontSize: 13, color: "var(--ink-2)" }}>Esta tarea viene de una rutina. Los cambios aplican solo a este día; la rutina se edita en la pestaña Rutinas.</div>
        : (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ flex: 1, fontSize: 16 }}>Repetir<span style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>La convierte en rutina.</span></span>
              <Toggle label="Repetir" checked={repeat} onChange={setRepeat} />
            </div>
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
        {!isNew && <button onClick={remove} disabled={busy} style={DANGER_BTN}>Eliminar</button>}
        <button onClick={onClose} style={{ ...TEXT_BTN, flex: 1, color: "var(--ink-2)" }}>Cancelar</button>
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
    <section style={{ ...CARD, position: "relative", overflow: "hidden", padding: "14px 16px 4px 20px",
      boxShadow: isNow ? "var(--shadow-card), inset 0 0 0 1.5px var(--accent)" : CARD.boxShadow }}>
      <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 14, bottom: 14, width: 4, borderRadius: "0 3px 3px 0",
        background: t.color, opacity: block.floating ? 0.45 : 1 }} />
      <button onClick={() => onEditDay(block)} aria-label={`Opciones de ${block.label || t.label} para este día`}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: "0 0 4px", cursor: "pointer", fontFamily: "inherit", color: "inherit", textAlign: "left" }}>
        <span style={{ fontSize: 17 }}>{t.icon}</span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 17, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{block.label || t.label}</span>
        {isNow && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", background: "var(--accent-soft)", borderRadius: 999, padding: "3px 9px" }}>Ahora</span>}
        {!isOcio && done && !isNow && <span style={{ display: "flex", color: "var(--good)" }} aria-label="Cumplido"><Icon name="check" size={17} stroke={2.4} /></span>}
        <span className="num" style={{ fontSize: 15, color: block.overridden ? "var(--warn)" : "var(--ink-2)" }}>
          {block.floating ? "~" : ""}{hhmm(block.start_time)}–{hhmm(block.end_time)}
        </span>
      </button>
      {isOcio ? (
        <div style={{ fontSize: 15, color: "var(--ink-2)", padding: "4px 0 12px" }}>Tiempo libre. Está en el plan.</div>
      ) : <>
        <div>
          {tasks.map((task, i) => <TaskRow key={task.id} task={task} onToggle={onToggle} onTap={onTap} divider={i > 0} />)}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: tasks.length ? "0.5px solid var(--border)" : "none" }}>
          <button onClick={() => onAdd(block)} style={{ ...TEXT_BTN, fontSize: 15, display: "flex", alignItems: "center", gap: 4, padding: "10px 0" }}>
            <Icon name="plus" size={18} stroke={2.2} /> Tarea
          </button>
          {started && !done && (
            <button onClick={() => onCheckin(block, true)} style={{ ...TEXT_BTN, fontSize: 15, color: "var(--good)", padding: "10px 0" }}>Estuve</button>
          )}
          {done && <span style={{ fontSize: 13, color: "var(--good)", fontWeight: 600 }}>Cumplido</span>}
        </div>
      </>}
    </section>
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
          {checked ? "Quitar \"Estuve\"" : "Estuve en este bloque"}
        </button>
      )}
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>Estos cambios aplican solo a este día. Tu semana tipo no se toca.</div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={LABEL}>Desde</div>
          <input type="time" value={start} onChange={e => setStart(e.target.value)} style={{ ...FIELD, fontVariantNumeric: "tabular-nums" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={LABEL}>Hasta</div>
          <input type="time" value={end} onChange={e => setEnd(e.target.value)} style={{ ...FIELD, fontVariantNumeric: "tabular-nums" }} />
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
        <button onClick={onClose} style={{ ...TEXT_BTN, flex: 1, color: "var(--ink-2)" }}>Cancelar</button>
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
    <div className="glass" style={{ borderTop: "0.5px solid var(--border)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      {types.length > 0 && text.trim() && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" }}>
          <BlockTypePicker value={blockType} onChange={setBlockType} allowNone types={types} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Nueva tarea" aria-label="Nueva tarea para este día"
          style={{ ...FIELD, borderRadius: 20, padding: "10px 16px", background: "var(--surface)", boxShadow: "inset 0 0 0 0.5px var(--border)" }} />
        <button onClick={send} disabled={busy || !text.trim()} aria-label="Agregar"
          style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center", opacity: busy || !text.trim() ? 0.35 : 1, transition: "opacity 0.2s" }}>
          <Icon name="arrowUp" size={20} stroke={2.4} />
        </button>
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
  if (done === 0) return <div className="num" style={{ fontSize: 15, color: "var(--ink-2)" }}>{tasks.length} cosa{tasks.length === 1 ? "" : "s"} para hoy</div>;
  const pct = Math.round((done / tasks.length) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div role="img" aria-label={`${done} hechas`} style={{ flex: 1, height: 4, background: "var(--surface-3)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--good-fill)", borderRadius: 2, transition: "width 0.5s var(--ease-spring)" }} />
      </div>
      <span className="num" style={{ fontSize: 15, color: "var(--good)", fontWeight: 600, whiteSpace: "nowrap" }}>
        {done === tasks.length ? "Todo hecho" : `${done} hecha${done === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

// Título grande: "Hoy" / "Mañana" / "Ayer", o "Martes 29"; debajo la fecha completa o el mes.
function dayHeading(s, today) {
  const d = parseYmd(s);
  const rel = s === today ? "Hoy" : s === addDays(today, 1) ? "Mañana" : s === addDays(today, -1) ? "Ayer" : null;
  const wd = d.toLocaleDateString("es-AR", { weekday: "long" });
  const full = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  return rel
    ? { title: rel, subtitle: full.charAt(0).toUpperCase() + full.slice(1) }
    : { title: `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${d.getDate()}`, subtitle: d.toLocaleDateString("es-AR", { month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase()) };
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
    if (!task.done) haptic();
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
    if (on) haptic();
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
      <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div role="tablist" aria-label="Vista de la agenda" style={{ display: "flex", background: "var(--surface-3)", borderRadius: 9, padding: 2 }}>
          {MODES.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
              style={{ flex: 1, padding: "6px 0", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: 13,
                fontWeight: mode === k ? 600 : 500, color: "var(--ink)", transition: "background 0.25s var(--ease-sheet)",
                background: mode === k ? "var(--surface)" : "transparent",
                boxShadow: mode === k ? "0 3px 8px rgba(0,0,0,0.12), 0 3px 1px rgba(0,0,0,0.04)" : "none" }}>
              {label}
            </button>
          ))}
        </div>
        {mode === "ahora" ? null : mode === "mes" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={LARGE_TITLE}>{monthTitle(monthAnchor)}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setMonthAnchor(firstOfMonth(monthAnchor, -1))} aria-label="Mes anterior" style={NAV_BTN}><Icon name="left" size={18} stroke={2.2} /></button>
              <button onClick={() => setMonthAnchor(firstOfMonth(monthAnchor, 1))} aria-label="Mes siguiente" style={NAV_BTN}><Icon name="right" size={18} stroke={2.2} /></button>
            </div>
          </div>
        ) : <>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={LARGE_TITLE}>{dayHeading(selected, today).title}</div>
              <div style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 4 }}>{dayHeading(selected, today).subtitle}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {!isToday && <button onClick={() => setSelected(today)} style={{ ...LINK_BTN, fontWeight: 600, marginRight: 4 }}>Hoy</button>}
              <button onClick={() => setSelected(addDays(selected, -7))} aria-label="Semana anterior" style={NAV_BTN}><Icon name="left" size={18} stroke={2.2} /></button>
              <button onClick={() => setSelected(addDays(selected, 7))} aria-label="Semana siguiente" style={NAV_BTN}><Icon name="right" size={18} stroke={2.2} /></button>
            </div>
          </div>
          <WeekStrip selected={selected} today={today} counts={counts} onSelect={setSelected} />
          <DayProgress tasks={shownTasks} />
        </>}
        {mode === "mes" && firstOfMonth(today) !== monthAnchor && (
          <button onClick={() => setMonthAnchor(firstOfMonth(today))} style={{ ...LINK_BTN, alignSelf: "flex-start", fontWeight: 600 }}>Volver a este mes</button>
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

      <div className="view-in" key={`dia-${selected}`} style={{ flex: 1, overflowY: "auto", padding: "4px 16px 28px", display: "flex", flexDirection: "column", gap: 12, opacity: loading ? 0.55 : 1, transition: "opacity 0.2s" }}>
        {error && <div style={ERROR_BOX}>{error}</div>}

        {(dayBirthdays.length > 0 || dayNotes.length > 0) && (
          <div style={{ ...CARD, padding: "4px 16px" }}>
            {dayBirthdays.map((b, i) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i ? "0.5px solid var(--border)" : "none" }}>
                <span style={{ fontSize: 20 }}>🎂</span>
                <span style={{ flex: 1, fontSize: 16 }}>Cumple de {b.name}</span>
                {b.year && <span className="num" style={{ fontSize: 15, color: "var(--ink-2)" }}>{year - b.year} años</span>}
              </div>
            ))}
            {dayNotes.map((n, i) => (
              <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i || dayBirthdays.length ? "0.5px solid var(--border)" : "none" }}>
                <span style={{ fontSize: 20 }}>📝</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 16, wordBreak: "break-word" }}>
                  {n.text}
                  {n.remind_time && <span className="num" style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{hhmm(n.remind_time)}</span>}
                </span>
                <button onClick={() => archiveNote(n)} style={{ ...TEXT_BTN, fontSize: 15 }}>Listo</button>
              </div>
            ))}
          </div>
        )}

        {notice && <div style={{ background: "var(--good-bg)", color: "var(--good)", borderRadius: 12, padding: "12px 14px", fontSize: 15 }}>{notice}</div>}

        {dayOverride && (
          <div style={{ ...CARD, padding: "16px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, lineHeight: 1.4 }}>
              <span style={{ display: "block", fontSize: 17, fontWeight: 600 }}>Día atípico{dayOverride.note ? `: ${dayOverride.note}` : ""}</span>
              <span style={{ display: "block", fontSize: 14, color: "var(--ink-2)", marginTop: 2 }}>Los bloques de hoy quedan en pausa.</span>
            </span>
            <button onClick={undoAtypical} style={{ ...TEXT_BTN, fontSize: 15 }}>Deshacer</button>
          </div>
        )}

        {cancelled.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {cancelled.map(c => {
              const wb = c.weekly_blocks, t = BLOCK_TYPE[wb?.block_type] || BLOCK_TYPE.otro;
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--ink-2)", padding: "0 4px" }}>
                  <span style={{ flex: 1 }}>{t.icon} {wb?.label || t.label} <span className="num">{hhmm(wb?.start_time)}–{hhmm(wb?.end_time)}</span>, cancelado hoy</span>
                  <button onClick={() => restoreBlock(c.block_id)} style={{ ...TEXT_BTN, fontSize: 14 }}>Restaurar</button>
                </div>
              );
            })}
          </div>
        )}

        {!loading && !dayOverride && blocks.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink-2)", fontSize: 15, padding: "28px 16px", lineHeight: 1.5 }}>
            No hay bloques este día.<br />Los armás en Configuración, con el engranaje de arriba.
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
          <section style={{ ...CARD, padding: "14px 16px 4px" }}>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", paddingBottom: 4 }}>Sin bloque</div>
            {loose.map((t, i) => <TaskRow key={t.id} task={t} onToggle={toggle} onTap={setSheet} showType divider={i > 0} />)}
          </section>
        )}

        {!dayOverride && selected >= today && (
          <button onClick={() => setAtypicalSheet(true)} style={{ ...TEXT_BTN, fontSize: 15, color: "var(--ink-2)", alignSelf: "center", marginTop: 4 }}>
            Marcar como día atípico
          </button>
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

const NAV_BTN = { width: 36, height: 36, borderRadius: "50%", border: "none", background: "var(--surface)", boxShadow: "var(--shadow-card)", cursor: "pointer",
  color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 };
const LINK_BTN = { background: "none", border: "none", padding: "2px 0", fontFamily: "inherit", fontSize: 15, color: "var(--accent)", cursor: "pointer", whiteSpace: "nowrap" };
