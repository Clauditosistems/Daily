import { useState, useEffect, useRef } from "react";
import {
  fetchBlocksForDay, fetchTasksForDate, fetchOverdueTasks, fetchPendingCounts,
  createTask, updateTask, deleteTask, fetchRoutines, ensureRoutineTasks,
} from "./supabase";
import {
  BLOCK_TYPE, PRIO, PRIO_ORDER, hhmm, toMinutes, parseYmd, todayStr, addDays, weekDates, dayTitle,
  FIELD, LABEL, PRIMARY_BTN, GHOST_BTN, ERROR_BOX, SECTION, Sheet, BlockTypePicker, PrioPicker,
} from "./ui";

const byPriority = (a, b) =>
  (a.done - b.done) || (PRIO_ORDER[a.prio] - PRIO_ORDER[b.prio]) || a.created_at.localeCompare(b.created_at);

// Una tarea va al bloque que tiene asignado; si no, al primer bloque del día de su mismo tipo.
function placeTasks(blocks, tasks) {
  const inBlock = Object.fromEntries(blocks.map(b => [b.block_id, []]));
  const loose = [];
  tasks.forEach(t => {
    if (t.block_id && inBlock[t.block_id]) return inBlock[t.block_id].push(t);
    const match = t.block_type && blocks.find(b => b.block_type === t.block_type);
    if (match) return inBlock[match.block_id].push(t);
    loose.push(t);
  });
  Object.values(inBlock).forEach(list => list.sort(byPriority));
  loose.sort(byPriority);
  return { inBlock, loose };
}

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
              border: `1.5px solid ${active ? "#1a1814" : isToday ? "#b8640a" : "transparent"}`,
              background: active ? "#1a1814" : "transparent", color: active ? "#f5f2ec" : "#1a1814",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <span style={{ fontSize: 9, fontFamily: "monospace", textTransform: "uppercase", opacity: 0.6 }}>
              {date.toLocaleDateString("es-AR", { weekday: "short" }).slice(0, 2)}
            </span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{date.getDate()}</span>
            <span style={{ height: 5, width: 5, borderRadius: "50%", background: counts[d] ? (active ? "#f5f2ec" : "#b8640a") : "transparent" }} />
          </button>
        );
      })}
    </div>
  );
}

// ─── TAREA ───────────────────────────────────────────────────
function TaskRow({ task, onToggle, onTap, showDate, showType }) {
  const t = BLOCK_TYPE[task.block_type];
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 2px" }}>
      <button onClick={() => onToggle(task)} aria-label={task.done ? "Marcar pendiente" : "Marcar hecha"}
        style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1, cursor: "pointer",
          border: `2px solid ${task.done ? "#1a9460" : PRIO[task.prio]?.color || "#d8d2c6"}`,
          background: task.done ? "#1a9460" : "transparent", color: "#fff", fontSize: 12, lineHeight: 1, padding: 0 }}>
        {task.done ? "✓" : ""}
      </button>
      <button onClick={() => onTap(task)}
        style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
        <span style={{ display: "block", fontSize: 14, lineHeight: 1.45, color: task.done ? "#a09890" : "#1a1814", textDecoration: task.done ? "line-through" : "none", wordBreak: "break-word" }}>
          {task.text}
        </span>
        {(task.routine_id || task.rollover_count > 0 || showDate || (showType && t)) && (
          <span style={{ display: "flex", gap: 8, fontFamily: "monospace", fontSize: 9.5, color: "#a09890", marginTop: 2 }}>
            {showType && t && <span style={{ color: t.color }}>{t.icon} {t.label}</span>}
            {showDate && <span style={{ color: "#c0392b" }}>{parseYmd(task.assigned_date).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</span>}
            {task.routine_id && <span>🔁 rutina</span>}
            {task.rollover_count > 0 && <span>↻ {task.rollover_count}</span>}
          </span>
        )}
      </button>
    </div>
  );
}

function TaskSheet({ task, onSave, onDelete, onClose }) {
  const isNew = !task.id;
  const [text, setText]           = useState(task.text || "");
  const [date, setDate]           = useState(task.assigned_date);
  const [blockType, setBlockType] = useState(task.block_type ?? null);
  const [prio, setPrio]           = useState(task.prio || "mid");
  const [error, setError]         = useState("");
  const [busy, setBusy]           = useState(false);

  async function save() {
    if (!text.trim()) return setError("Escribí la tarea.");
    if (!date) return setError("Elegí una fecha.");
    const changes = { text: text.trim(), assigned_date: date, block_type: blockType, prio };
    // Si cambió el día o el tipo, deja de estar atada a un bloque puntual.
    if (date !== task.assigned_date || blockType !== (task.block_type ?? null)) changes.block_id = null;
    setBusy(true); setError("");
    try { await onSave(changes); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try { await onDelete(task.id); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Sheet title={isNew ? "Nueva tarea" : "Editar tarea"} onClose={onClose}>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} autoFocus={isNew}
        placeholder="¿Qué hay que hacer?" style={{ ...FIELD, resize: "none", lineHeight: 1.45 }} />
      <div>
        <div style={LABEL}>Día</div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...FIELD, fontFamily: "monospace" }} />
      </div>
      <div>
        <div style={LABEL}>Bloque</div>
        <BlockTypePicker value={blockType} onChange={setBlockType} allowNone />
      </div>
      <div>
        <div style={LABEL}>Prioridad</div>
        <PrioPicker value={prio} onChange={setPrio} />
      </div>
      {task.routine_id && <div style={{ fontSize: 12, color: "#a09890" }}>🔁 Esta tarea viene de una rutina. Los cambios aplican solo a este día.</div>}
      {error && <div style={ERROR_BOX}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {!isNew && <button onClick={remove} disabled={busy} style={{ ...GHOST_BTN, color: "#c0392b", borderColor: "#f0c8c0" }}>🗑</button>}
        <button onClick={onClose} style={{ ...GHOST_BTN, flex: 1 }}>Cancelar</button>
        <button onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, flex: 2, opacity: busy ? 0.6 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </Sheet>
  );
}

// ─── BLOQUE ──────────────────────────────────────────────────
function BlockCard({ block, tasks, isNow, onAdd, onToggle, onTap }) {
  const t = BLOCK_TYPE[block.block_type] || BLOCK_TYPE.otro;
  const pending = tasks.filter(x => !x.done).length;
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${isNow ? t.color : "#d8d2c6"}`, borderLeft: `5px ${block.floating ? "dashed" : "solid"} ${t.color}`, borderRadius: 15, padding: "10px 12px 6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{t.icon}</span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{block.label || t.label}</span>
        {isNow && <span style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 700, color: "#fff", background: t.color, borderRadius: 6, padding: "2px 6px" }}>AHORA</span>}
        <span style={{ fontFamily: "monospace", fontSize: 11, color: "#5a5248" }}>{block.floating ? "~" : ""}{hhmm(block.start_time)}–{hhmm(block.end_time)}</span>
      </div>
      <div style={{ marginTop: 4 }}>
        {tasks.map(task => <TaskRow key={task.id} task={task} onToggle={onToggle} onTap={onTap} />)}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 0" }}>
        <button onClick={() => onAdd(block)}
          style={{ background: "none", border: "none", color: t.color, fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "6px 0" }}>
          + Tarea
        </button>
        {tasks.length > 0 && <span style={{ fontFamily: "monospace", fontSize: 10, color: "#a09890" }}>{tasks.length - pending}/{tasks.length}</span>}
      </div>
    </div>
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
    <div style={{ borderTop: "1px solid #d8d2c6", background: "#f5f2ec", padding: "8px 12px calc(10px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 7 }}>
      {types.length > 0 && (
        <div style={{ display: "flex", gap: 5, overflowX: "auto", scrollbarWidth: "none" }}>
          <BlockTypePicker value={blockType} onChange={setBlockType} allowNone types={types} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Agregar tarea a este día…" style={{ ...FIELD, background: "#fff" }} />
        <button onClick={send} disabled={busy} aria-label="Agregar"
          style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "#1a1814", color: "#f5f2ec", fontSize: 16, cursor: "pointer", flexShrink: 0, opacity: busy ? 0.6 : 1 }}>↑</button>
      </div>
    </div>
  );
}

// ─── VISTA PRINCIPAL ─────────────────────────────────────────
export default function AgendaView() {
  const today = todayStr();
  const [selected, setSelected] = useState(today);
  const [routines, setRoutines] = useState(null);
  const [blocks, setBlocks]     = useState([]);
  const [tasks, setTasks]       = useState([]);
  const [overdue, setOverdue]   = useState([]);
  const [counts, setCounts]     = useState({});
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [sheet, setSheet]       = useState(null);  // tarea existente o borrador
  const requestId = useRef(0);

  useEffect(() => {
    fetchRoutines().then(setRoutines).catch(err => { setError(err.message); setRoutines([]); });
  }, []);

  useEffect(() => {
    if (!routines) return;
    const id = ++requestId.current;
    const week = weekDates(selected);
    setLoading(true);
    (async () => {
      try {
        await ensureRoutineTasks(routines, week, today);
        const [b, t, o, c] = await Promise.all([
          fetchBlocksForDay(selected),
          fetchTasksForDate(selected),
          selected === today ? fetchOverdueTasks(today) : Promise.resolve([]),
          fetchPendingCounts(week[0], week[6]),
        ]);
        if (id !== requestId.current) return;  // el usuario ya cambió de día
        setBlocks(b); setTasks(t); setOverdue(o); setCounts(c); setError("");
      } catch (err) {
        if (id === requestId.current) setError(err.message);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    })();
  }, [selected, routines, today]);

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
    setOverdue(p => p.filter(t => t.id !== updated.id));
  }

  async function toggle(task) {
    try { applyTask(await updateTask(task.id, { done: !task.done })); refreshCounts(); }
    catch (err) { setError(err.message); }
  }

  async function saveTask(changes) {
    const saved = sheet.id ? await updateTask(sheet.id, changes) : await createTask({ ...changes, block_id: sheet.block_id ?? null });
    applyTask(saved);
    refreshCounts();
  }

  async function removeTask(id) {
    await deleteTask(id);
    setTasks(p => p.filter(t => t.id !== id));
    setOverdue(p => p.filter(t => t.id !== id));
    refreshCounts();
  }

  async function quickAdd(text, blockType) {
    try {
      const saved = await createTask({ text, assigned_date: selected, block_type: blockType });
      applyTask(saved);
      refreshCounts();
    } catch (err) { setError(err.message); }
  }

  async function moveToToday(list) {
    try {
      const moved = await Promise.all(list.map(t =>
        updateTask(t.id, { assigned_date: today, block_id: null, rollover_count: t.rollover_count + 1 })));
      moved.forEach(applyTask);
      refreshCounts();
    } catch (err) { setError(err.message); }
  }

  const { inBlock, loose } = placeTasks(blocks, tasks);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const typesToday = [...new Set(blocks.map(b => b.block_type))];
  const isToday = selected === today;

  return (
    <>
      <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid #ebe6dc", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setSelected(addDays(selected, -1))} aria-label="Día anterior" style={NAV_BTN}>‹</button>
          <div style={{ flex: 1, textAlign: "center", fontWeight: 800, fontSize: 15 }}>{dayTitle(selected)}</div>
          <button onClick={() => setSelected(addDays(selected, 1))} aria-label="Día siguiente" style={NAV_BTN}>›</button>
        </div>
        <WeekStrip selected={selected} today={today} counts={counts} onSelect={setSelected} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 16 }}>
          <button onClick={() => setSelected(addDays(selected, -7))} style={LINK_BTN}>‹ semana</button>
          {!isToday && <button onClick={() => setSelected(today)} style={{ ...LINK_BTN, fontWeight: 700, color: "#b8640a" }}>Volver a hoy</button>}
          <button onClick={() => setSelected(addDays(selected, 7))} style={LINK_BTN}>semana ›</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 24px", display: "flex", flexDirection: "column", gap: 10, opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
        {error && <div style={ERROR_BOX}>{error}</div>}

        {isToday && overdue.length > 0 && (
          <div style={{ background: "#fdf1ee", border: "1.5px solid #f0c8c0", borderRadius: 15, padding: "10px 12px 6px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ ...SECTION, color: "#c0392b", padding: 0 }}>⚠ Atrasadas ({overdue.length})</span>
              <button onClick={() => moveToToday(overdue)} style={{ ...LINK_BTN, color: "#c0392b", fontWeight: 700 }}>Pasar todas a hoy</button>
            </div>
            {overdue.map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}><TaskRow task={t} onToggle={toggle} onTap={setSheet} showDate showType /></div>
                <button onClick={() => moveToToday([t])} style={{ ...LINK_BTN, color: "#c0392b" }}>→ hoy</button>
              </div>
            ))}
          </div>
        )}

        {!loading && blocks.length === 0 && (
          <div style={{ textAlign: "center", color: "#a09890", fontSize: 13, padding: "18px 10px", lineHeight: 1.6 }}>
            No hay bloques este día.<br /><span style={{ fontSize: 11.5 }}>Los configurás en la pestaña ⚙ Semana.</span>
          </div>
        )}

        {blocks.map(b => (
          <BlockCard key={b.block_id} block={b} tasks={inBlock[b.block_id]}
            isNow={isToday && !b.floating && nowMin >= toMinutes(b.start_time) && nowMin < toMinutes(b.end_time)}
            onAdd={block => setSheet({ assigned_date: selected, block_type: block.block_type, block_id: block.block_id, prio: "mid" })}
            onToggle={toggle} onTap={setSheet} />
        ))}

        {loose.length > 0 && (
          <div style={{ background: "#fff", border: "1.5px solid #d8d2c6", borderRadius: 15, padding: "10px 12px 6px" }}>
            <div style={{ ...SECTION, color: "#6b6457", padding: 0 }}>Sin bloque</div>
            {loose.map(t => <TaskRow key={t.id} task={t} onToggle={toggle} onTap={setSheet} showType />)}
          </div>
        )}
      </div>

      <Composer key={selected} types={typesToday} onAdd={quickAdd} />

      {sheet && (
        <TaskSheet key={sheet.id || "new"} task={sheet} onSave={saveTask} onDelete={removeTask} onClose={() => setSheet(null)} />
      )}
    </>
  );
}

const NAV_BTN = { width: 34, height: 34, borderRadius: "50%", border: "1.5px solid #d8d2c6", background: "transparent", fontSize: 18, lineHeight: 1, cursor: "pointer", color: "#1a1814", fontFamily: "inherit" };
const LINK_BTN = { background: "none", border: "none", padding: "2px 4px", fontFamily: "inherit", fontSize: 11.5, color: "#a09890", cursor: "pointer", whiteSpace: "nowrap" };
