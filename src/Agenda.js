import { useState, useEffect, useRef } from "react";
import {
  fetchBlocksForDay, fetchTasksForDate, fetchPendingCounts, createTask, updateTask, deleteTask,
  fetchRoutines, ensureRoutineTasks, rolloverMine, fetchDayOverride, markAtypical, unmarkAtypical,
  fetchCancelledBlocks, setBlockOverride, clearBlockOverride,
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
function TaskRow({ task, onToggle, onTap, showType }) {
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
        {(task.routine_id || task.rollover_count > 0 || (showType && t)) && (
          <span style={{ display: "flex", gap: 8, fontFamily: "monospace", fontSize: 9.5, color: "#a09890", marginTop: 2 }}>
            {showType && t && <span style={{ color: t.color }}>{t.icon} {t.label}</span>}
            {task.routine_id && <span>🔁 rutina</span>}
            {task.rollover_count > 0 && !task.done && (
              <span style={{ color: task.rollover_count >= 3 ? "#c0392b" : "#b8640a", fontWeight: 700 }}>
                ↻ pasó {task.rollover_count} {task.rollover_count === 1 ? "vez" : "veces"}
              </span>
            )}
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
function BlockCard({ block, tasks, isNow, onAdd, onEditDay, onToggle, onTap }) {
  const t = BLOCK_TYPE[block.block_type] || BLOCK_TYPE.otro;
  const pending = tasks.filter(x => !x.done).length;
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${isNow ? t.color : "#d8d2c6"}`, borderLeft: `5px ${block.floating ? "dashed" : "solid"} ${t.color}`, borderRadius: 15, padding: "10px 12px 6px" }}>
      <button onClick={() => onEditDay(block)} aria-label="Cambiar este bloque solo este día"
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", color: "inherit", textAlign: "left" }}>
        <span style={{ fontSize: 16 }}>{t.icon}</span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{block.label || t.label}</span>
        {isNow && <span style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 700, color: "#fff", background: t.color, borderRadius: 6, padding: "2px 6px" }}>AHORA</span>}
        <span style={{ fontFamily: "monospace", fontSize: 11, color: block.overridden ? "#b8640a" : "#5a5248", fontWeight: block.overridden ? 700 : 400 }}>
          {block.overridden ? "✎ " : ""}{block.floating ? "~" : ""}{hhmm(block.start_time)}–{hhmm(block.end_time)}
        </span>
      </button>
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

// ─── CAMBIAR UN BLOQUE SOLO ESE DÍA ──────────────────────────
function BlockDaySheet({ block, date, onDone, onClose }) {
  const t = BLOCK_TYPE[block.block_type] || BLOCK_TYPE.otro;
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
      <div style={{ fontSize: 12.5, color: "#6b6457", lineHeight: 1.5 }}>Estos cambios aplican solo a este día. Tu semana tipo no se toca.</div>
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
      <button onClick={() => run(() => setBlockOverride(block.block_id, date, { cancelled: true }))} disabled={busy}
        style={{ ...GHOST_BTN, color: "#c0392b", borderColor: "#f0c8c0" }}>Cancelar el bloque este día</button>
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
      <div style={{ fontSize: 12.5, color: "#6b6457", lineHeight: 1.55 }}>
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
  const [dayOverride, setDayOverride] = useState(null);
  const [cancelled, setCancelled]     = useState([]);
  const [reloadKey, setReloadKey]     = useState(0);
  const [notice, setNotice]           = useState("");
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
  }, []);

  useEffect(() => {
    if (!routines) return;
    const id = ++requestId.current;
    const week = weekDates(selected);
    setLoading(true);
    (async () => {
      try {
        await ensureRoutineTasks(routines, week, today);
        const [b, t, c, o, x] = await Promise.all([
          fetchBlocksForDay(selected),
          fetchTasksForDate(selected),
          fetchPendingCounts(week[0], week[6]),
          fetchDayOverride(selected),
          fetchCancelledBlocks(selected),
        ]);
        if (id !== requestId.current) return;  // el usuario ya cambió de día
        setBlocks(b); setTasks(t); setCounts(c); setDayOverride(o); setCancelled(x); setError("");
      } catch (err) {
        if (id === requestId.current) setError(err.message);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    })();
  }, [selected, routines, today, reloadKey]);

  useEffect(() => { setNotice(""); }, [selected]);
  const reload = () => setReloadKey(k => k + 1);

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

  async function saveTask(changes) {
    const saved = sheet.id ? await updateTask(sheet.id, changes) : await createTask({ ...changes, block_id: sheet.block_id ?? null });
    applyTask(saved);
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

  async function undoAtypical() {
    try { await unmarkAtypical(dayOverride.id); setNotice(""); reload(); }
    catch (err) { setError(err.message); }
  }

  async function restoreBlock(blockId) {
    try { await clearBlockOverride(blockId, selected); reload(); }
    catch (err) { setError(err.message); }
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
          {!dayOverride && selected >= today && (
            <button onClick={() => setAtypicalSheet(true)} style={LINK_BTN}>☾ día atípico</button>
          )}
          <button onClick={() => setSelected(addDays(selected, 7))} style={LINK_BTN}>semana ›</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 24px", display: "flex", flexDirection: "column", gap: 10, opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>
        {error && <div style={ERROR_BOX}>{error}</div>}

        {notice && <div style={{ background: "#edf8f3", color: "#1a9460", borderRadius: 10, padding: "9px 12px", fontSize: 12.5 }}>{notice}</div>}

        {dayOverride && (
          <div style={{ background: "#f2f0ec", border: "1.5px dashed #a09890", borderRadius: 15, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>☾</span>
            <span style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}>
              <b>Día atípico</b>{dayOverride.note ? `: ${dayOverride.note}` : ""}
              <span style={{ display: "block", fontSize: 11.5, color: "#a09890" }}>Sin bloques. Las tareas que se movieron no vuelven solas.</span>
            </span>
            <button onClick={undoAtypical} style={{ ...LINK_BTN, color: "#1a1814", fontWeight: 700 }}>Deshacer</button>
          </div>
        )}

        {cancelled.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {cancelled.map(c => {
              const wb = c.weekly_blocks, t = BLOCK_TYPE[wb?.block_type] || BLOCK_TYPE.otro;
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#a09890", padding: "0 4px" }}>
                  <span style={{ textDecoration: "line-through", flex: 1 }}>{t.icon} {wb?.label || t.label} {hhmm(wb?.start_time)}–{hhmm(wb?.end_time)}</span>
                  <span>cancelado</span>
                  <button onClick={() => restoreBlock(c.block_id)} style={{ ...LINK_BTN, color: "#1a1814" }}>Restaurar</button>
                </div>
              );
            })}
          </div>
        )}

        {!loading && !dayOverride && blocks.length === 0 && (
          <div style={{ textAlign: "center", color: "#a09890", fontSize: 13, padding: "18px 10px", lineHeight: 1.6 }}>
            No hay bloques este día.<br /><span style={{ fontSize: 11.5 }}>Los configurás en la pestaña ⚙ Semana.</span>
          </div>
        )}

        {blocks.map(b => (
          <BlockCard key={b.block_id} block={b} tasks={inBlock[b.block_id]}
            isNow={isToday && !b.floating && nowMin >= toMinutes(b.start_time) && nowMin < toMinutes(b.end_time)}
            onAdd={block => setSheet({ assigned_date: selected, block_type: block.block_type, block_id: block.block_id, prio: "mid" })}
            onEditDay={setBlockSheet}
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
      {blockSheet && (
        <BlockDaySheet block={blockSheet} date={selected} onDone={reload} onClose={() => setBlockSheet(null)} />
      )}
      {atypicalSheet && (
        <AtypicalSheet date={selected} onClose={() => setAtypicalSheet(false)}
          onDone={moved => { setNotice(moved ? `Se movieron ${moved} tarea${moved === 1 ? "" : "s"} a su próximo bloque.` : ""); reload(); }} />
      )}
    </>
  );
}

const NAV_BTN = { width: 34, height: 34, borderRadius: "50%", border: "1.5px solid #d8d2c6", background: "transparent", fontSize: 18, lineHeight: 1, cursor: "pointer", color: "#1a1814", fontFamily: "inherit" };
const LINK_BTN = { background: "none", border: "none", padding: "2px 4px", fontFamily: "inherit", fontSize: 11.5, color: "#a09890", cursor: "pointer", whiteSpace: "nowrap" };
