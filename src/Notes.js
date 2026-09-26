import { useState, useEffect } from "react";
import {
  fetchNotes, createNote, updateNote, deleteNote, createTask,
  fetchBirthdays, saveBirthday, deleteBirthday,
} from "./supabase";
import {
  hhmm, parseYmd, todayStr, birthdayOn,
  FIELD, LABEL, CHIP, PRIMARY_BTN, GHOST_BTN, ERROR_BOX, Sheet, DANGER_BTN, TEXT_BTN, Group, Row, Icon, ScreenTitle, Segmented
} from "./ui";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const shortDate = s => parseYmd(s).toLocaleDateString("es-AR", { day: "numeric", month: "short" });

function relativeDays(n) {
  if (n === 0) return "¡hoy!";
  if (n === 1) return "mañana";
  return `en ${n} días`;
}

const LINK_BTN = { background: "none", border: "none", padding: "2px 4px", fontFamily: "inherit", fontSize: 13, color: "var(--ink-3)", cursor: "pointer" };

// ─── NOTAS E IDEAS ───────────────────────────────────────────
function NoteSheet({ note, onSave, onDelete, onToTask, onClose }) {
  const isIdea = note.kind === "idea";
  const [text, setText]   = useState(note.text || "");
  const [date, setDate]   = useState(note.note_date || "");
  const [time, setTime]   = useState(hhmm(note.remind_time));
  const [error, setError] = useState("");
  const [busy, setBusy]   = useState(false);

  async function run(action) {
    setBusy(true); setError("");
    try { await action(); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  function save() {
    if (!text.trim()) return setError("Escribí algo.");
    const changes = isIdea
      ? { text: text.trim() }
      : { text: text.trim(), note_date: date || null, remind_time: date && time ? time : null };
    run(() => onSave(changes));
  }

  return (
    <Sheet title={isIdea ? "Idea" : "Nota"} onClose={onClose}>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder={isIdea ? "Tu idea…" : "Tu nota…"}
        style={{ ...FIELD, resize: "vertical", lineHeight: 1.5 }} />
      {!isIdea && (
        <div>
          <div style={LABEL}>Recordarme (opcional)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...FIELD, fontVariantNumeric: "tabular-nums", flex: 2 }} />
            <input type="time" value={time} onChange={e => setTime(e.target.value)} disabled={!date} style={{ ...FIELD, fontVariantNumeric: "tabular-nums", flex: 1, opacity: date ? 1 : 0.5 }} />
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 5 }}>
            {date ? "Aparece en la agenda ese día y te avisa (sin hora, a la hora de la mañana que elegiste en Configuración)." : "Sin fecha queda solo acá."}
          </div>
        </div>
      )}
      {error && <div style={ERROR_BOX}>{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => run(() => onDelete(note.id))} disabled={busy} style={DANGER_BTN}>Eliminar</button>
        <button onClick={() => run(() => onSave({ archived: !note.archived }))} disabled={busy} style={GHOST_BTN}>
          {note.archived ? "Desarchivar" : "Archivar"}
        </button>
        {isIdea && !note.archived && (
          <button onClick={() => run(() => onToTask(text.trim()))} disabled={busy} style={GHOST_BTN}>→ Pasar a tarea</button>
        )}
        <button onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, flex: 1, opacity: busy ? 0.6 : 1 }}>Guardar</button>
      </div>
    </Sheet>
  );
}

function NotesList({ kind }) {
  const [notes, setNotes]       = useState([]);
  const [archived, setArchived] = useState(false);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [sheet, setSheet]       = useState(null);
  const [text, setText]         = useState("");
  const [notice, setNotice]     = useState("");
  const today = todayStr();

  useEffect(() => {
    setLoading(true);
    fetchNotes(kind, archived).then(setNotes).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, [kind, archived]);

  async function add() {
    if (!text.trim()) return;
    try { const n = await createNote({ kind, text: text.trim() }); setNotes(p => [n, ...p]); setText(""); }
    catch (err) { setError(err.message); }
  }

  async function save(changes) {
    const updated = await updateNote(sheet.id, changes);
    setNotes(p => updated.archived !== archived ? p.filter(n => n.id !== updated.id) : p.map(n => n.id === updated.id ? updated : n));
  }

  async function remove(id) {
    await deleteNote(id);
    setNotes(p => p.filter(n => n.id !== id));
  }

  async function toTask(taskText) {
    await createTask({ text: taskText, assigned_date: today });
    await updateNote(sheet.id, { archived: true });
    setNotes(p => p.filter(n => n.id !== sheet.id));
    setNotice("Listo: la pasé a tus tareas de hoy y archivé la idea.");
  }

  const isIdea = kind === "idea";
  return (
    <>
      <div className="view-in" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={ERROR_BOX}>{error}</div>}
        {notice && <div style={{ background: "var(--good-bg)", color: "var(--good)", borderRadius: 12, padding: "12px 14px", fontSize: 15 }}>{notice}</div>}
        {loading && <div style={{ color: "var(--ink-2)", fontSize: 15, padding: 20, textAlign: "center" }}>Cargando…</div>}
        {!loading && notes.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink-2)", fontSize: 16, padding: "40px 16px", lineHeight: 1.5 }}>
            {archived ? "No hay nada archivado." : isIdea ? "Anotá acá lo que se te ocurra." : "Notas sueltas, o con fecha para que te avise."}
          </div>
        )}
        {notes.length > 0 && (
          <Group>
            {notes.map((n, i) => {
              const past = n.note_date && n.note_date < today;
              return (
                <Row key={n.id} divider={i > 0} onClick={() => setSheet(n)} style={{ opacity: archived ? 0.6 : 1, alignItems: "flex-start" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.text}</span>
                    {n.note_date && (
                      <span className="num" style={{ display: "block", fontSize: 13, marginTop: 3, color: n.note_date === today ? "var(--accent)" : "var(--ink-2)", fontWeight: n.note_date === today ? 600 : 400 }}>
                        {n.note_date === today ? "Hoy" : shortDate(n.note_date)}{n.remind_time ? `, ${hhmm(n.remind_time)}` : ""}{past ? " (ya pasó)" : ""}
                      </span>
                    )}
                  </span>
                </Row>
              );
            })}
          </Group>
        )}
        {!loading && (
          <button onClick={() => setArchived(a => !a)} style={{ ...TEXT_BTN, fontSize: 15, alignSelf: "center" }}>
            {archived ? "Volver" : "Ver archivadas"}
          </button>
        )}
      </div>

      {!archived && (
        <div className="glass" style={{ borderTop: "0.5px solid var(--border)", padding: "10px 12px", display: "flex", gap: 8, alignItems: "center" }}>
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
            placeholder={isIdea ? "Nueva idea" : "Nueva nota"} aria-label={isIdea ? "Nueva idea" : "Nueva nota"}
            style={{ ...FIELD, borderRadius: 20, padding: "10px 16px", background: "var(--surface)", boxShadow: "inset 0 0 0 0.5px var(--border)" }} />
          <button onClick={add} aria-label="Agregar" disabled={!text.trim()}
            style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center", opacity: text.trim() ? 1 : 0.35, transition: "opacity 0.2s" }}>
            <Icon name="arrowUp" size={20} stroke={2.4} />
          </button>
        </div>
      )}

      {sheet && <NoteSheet key={sheet.id} note={sheet} onSave={save} onDelete={remove} onToTask={toTask} onClose={() => setSheet(null)} />}
    </>
  );
}

// ─── CUMPLEAÑOS ──────────────────────────────────────────────
function BirthdaySheet({ birthday, onSave, onDelete, onClose }) {
  const [name, setName]   = useState(birthday?.name || "");
  const [day, setDay]     = useState(birthday?.day || 1);
  const [month, setMonth] = useState(birthday?.month || new Date().getMonth() + 1);
  const [year, setYear]   = useState(birthday?.year ? String(birthday.year) : "");
  const [error, setError] = useState("");
  const [busy, setBusy]   = useState(false);

  const maxDay = month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31;

  async function run(action) {
    setBusy(true); setError("");
    try { await action(); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  function save() {
    if (!name.trim()) return setError("Poné el nombre.");
    const y = year.trim() ? Number(year) : null;
    if (y !== null && (!Number.isInteger(y) || y < 1900 || y > new Date().getFullYear())) return setError("El año no es válido.");
    run(() => onSave({ name: name.trim(), day: Math.min(day, maxDay), month, year: y }));
  }

  return (
    <Sheet title={birthday ? "Editar cumpleaños" : "Nuevo cumpleaños"} onClose={onClose}>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre" style={FIELD} autoFocus={!birthday} />
      <div>
        <div style={LABEL}>Fecha</div>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={day} onChange={e => setDay(Number(e.target.value))} style={{ ...FIELD, flex: 1 }}>
            {Array.from({ length: maxDay }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ ...FIELD, flex: 2 }}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>
      <div>
        <div style={LABEL}>Año de nacimiento (opcional)</div>
        <input value={year} onChange={e => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="Ej: 1990" style={{ ...FIELD, maxWidth: 140 }} />
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 5 }}>Si lo ponés, te digo cuántos cumple.</div>
      </div>
      {error && <div style={ERROR_BOX}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {birthday && <button onClick={() => run(() => onDelete(birthday.id))} disabled={busy} style={DANGER_BTN}>Eliminar</button>}
        <button onClick={onClose} style={{ ...TEXT_BTN, flex: 1, color: "var(--ink-2)" }}>Cancelar</button>
        <button onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, flex: 2, opacity: busy ? 0.6 : 1 }}>Guardar</button>
      </div>
    </Sheet>
  );
}

function nextOccurrence(b, today) {
  const year = parseYmd(today).getFullYear();
  let date = birthdayOn(b.month, b.day, year);
  if (date < today) date = birthdayOn(b.month, b.day, year + 1);
  const days = Math.round((parseYmd(date) - parseYmd(today)) / 86400000);
  const turns = b.year ? parseYmd(date).getFullYear() - b.year : null;
  return { date, days, turns };
}

function BirthdaysList() {
  const [list, setList]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [sheet, setSheet]     = useState(null);  // { birthday } o {} para nuevo
  const today = todayStr();

  useEffect(() => {
    fetchBirthdays().then(setList).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);

  async function save(data) {
    const saved = await saveBirthday(sheet.birthday?.id, data);
    setList(p => sheet.birthday ? p.map(b => b.id === saved.id ? saved : b) : [...p, saved]);
  }

  async function remove(id) {
    await deleteBirthday(id);
    setList(p => p.filter(b => b.id !== id));
  }

  const sorted = list.map(b => ({ b, ...nextOccurrence(b, today) })).sort((x, y) => x.days - y.days);

  return (
    <div className="view-in" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
      {error && <div style={ERROR_BOX}>{error}</div>}
      {loading && <div style={{ color: "var(--ink-2)", fontSize: 15, padding: 20, textAlign: "center" }}>Cargando…</div>}
      <Group footer={!loading && list.length === 0 ? "Agregá cumpleaños y te aviso ese día a la mañana." : null}>
        {sorted.map(({ b, days, turns }, i) => (
          <Row key={b.id} divider={i > 0} onClick={() => setSheet({ birthday: b })}>
            <span style={{ fontSize: 20 }}>🎂</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: days === 0 ? 600 : 400 }}>{b.name}</span>
              <span className="num" style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>
                {b.day} de {MONTHS[b.month - 1]}{turns !== null ? `, cumple ${turns}` : ""}
              </span>
            </span>
            <span className="num" style={{ fontSize: 15, whiteSpace: "nowrap", color: days <= 7 ? "var(--accent)" : "var(--ink-2)", fontWeight: days <= 7 ? 600 : 400 }}>
              {relativeDays(days)}
            </span>
          </Row>
        ))}
        <Row divider={sorted.length > 0} onClick={() => setSheet({})}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent)" }}>
            <Icon name="plus" size={18} stroke={2.2} /> Agregar cumpleaños
          </span>
        </Row>
      </Group>
      {sheet && <BirthdaySheet key={sheet.birthday?.id || "new"} birthday={sheet.birthday} onSave={save} onDelete={remove} onClose={() => setSheet(null)} />}
    </div>
  );
}

// ─── VISTA ───────────────────────────────────────────────────
const SECTIONS = [["note", "Notas"], ["idea", "Ideas"], ["birthday", "Cumples"]];

export default function NotesView() {
  const [section, setSection] = useState("note");
  return (
    <>
      <ScreenTitle title="Notas" />
      <div style={{ padding: "0 16px 14px" }}>
        <Segmented label="Secciones" value={section} onChange={setSection} options={SECTIONS} />
      </div>
      {section === "birthday" ? <BirthdaysList /> : <NotesList key={section} kind={section} />}
    </>
  );
}
