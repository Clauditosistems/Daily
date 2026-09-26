import { useState, useEffect } from "react";
import {
  fetchNotes, createNote, updateNote, deleteNote, createTask,
  fetchBirthdays, saveBirthday, deleteBirthday,
} from "./supabase";
import {
  hhmm, parseYmd, todayStr, birthdayOn,
  FIELD, LABEL, CHIP, PRIMARY_BTN, GHOST_BTN, ERROR_BOX, Sheet,
} from "./ui";

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const shortDate = s => parseYmd(s).toLocaleDateString("es-AR", { day: "numeric", month: "short" });

function relativeDays(n) {
  if (n === 0) return "¡hoy!";
  if (n === 1) return "mañana";
  return `en ${n} días`;
}

const LINK_BTN = { background: "none", border: "none", padding: "2px 4px", fontFamily: "inherit", fontSize: 12, color: "var(--ink-3)", cursor: "pointer" };

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
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...FIELD, fontFamily: "monospace", flex: 2 }} />
            <input type="time" value={time} onChange={e => setTime(e.target.value)} disabled={!date} style={{ ...FIELD, fontFamily: "monospace", flex: 1, opacity: date ? 1 : 0.5 }} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 5 }}>
            {date ? "Aparece en la agenda ese día y te avisa (sin hora, a la hora de la mañana que elegiste en Configuración)." : "Sin fecha queda solo acá."}
          </div>
        </div>
      )}
      {error && <div style={ERROR_BOX}>{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => run(() => onDelete(note.id))} disabled={busy} style={{ ...GHOST_BTN, color: "var(--bad)", borderColor: "var(--bad-border)" }}>🗑</button>
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
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 14px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
        {error && <div style={ERROR_BOX}>{error}</div>}
        {notice && <div style={{ background: "var(--good-bg)", color: "var(--good)", borderRadius: 10, padding: "9px 12px", fontSize: 12.5 }}>{notice}</div>}
        {loading && <div style={{ color: "var(--ink-3)", fontSize: 13, padding: 20, textAlign: "center" }}>Cargando…</div>}
        {!loading && notes.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 13, padding: "30px 10px", lineHeight: 1.6 }}>
            {archived ? "No hay nada archivado." : isIdea ? "💡 Anotá acá lo que se te ocurra." : "📝 Notas sueltas o con fecha para que te avise."}
          </div>
        )}
        {notes.map(n => {
          const past = n.note_date && n.note_date < today;
          return (
            <button key={n.id} onClick={() => setSheet(n)}
              style={{ textAlign: "left", background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 13, padding: "10px 12px", cursor: "pointer", fontFamily: "inherit", color: "var(--ink)", opacity: archived ? 0.6 : 1 }}>
              <span style={{ display: "block", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.text}</span>
              {n.note_date && (
                <span style={{ display: "block", fontFamily: "monospace", fontSize: 10.5, marginTop: 4, color: past ? "var(--ink-3)" : n.note_date === today ? "var(--warn)" : "var(--ink-2)", fontWeight: n.note_date === today ? 700 : 400 }}>
                  📅 {n.note_date === today ? "Hoy" : shortDate(n.note_date)}{n.remind_time ? ` · ${hhmm(n.remind_time)}` : ""}{past ? " · ya pasó" : ""}
                </span>
              )}
            </button>
          );
        })}
        {!loading && (
          <button onClick={() => setArchived(a => !a)} style={{ ...LINK_BTN, alignSelf: "center", marginTop: 4 }}>
            {archived ? "← Volver" : "Ver archivadas"}
          </button>
        )}
      </div>

      {!archived && (
        <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg)", padding: "8px 12px calc(10px + env(safe-area-inset-bottom))", display: "flex", gap: 8, alignItems: "center" }}>
          <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && add()}
            placeholder={isIdea ? "Nueva idea…" : "Nueva nota…"} style={{ ...FIELD, background: "var(--surface)" }} />
          <button onClick={add} aria-label="Agregar"
            style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "var(--ink)", color: "var(--bg)", fontSize: 16, cursor: "pointer", flexShrink: 0 }}>↑</button>
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
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 5 }}>Si lo ponés, te digo cuántos cumple.</div>
      </div>
      {error && <div style={ERROR_BOX}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {birthday && <button onClick={() => run(() => onDelete(birthday.id))} disabled={busy} style={{ ...GHOST_BTN, color: "var(--bad)", borderColor: "var(--bad-border)" }}>🗑</button>}
        <button onClick={onClose} style={{ ...GHOST_BTN, flex: 1 }}>Cancelar</button>
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
    <div style={{ flex: 1, overflowY: "auto", padding: "4px 14px 40px", display: "flex", flexDirection: "column", gap: 8 }}>
      {error && <div style={ERROR_BOX}>{error}</div>}
      {loading && <div style={{ color: "var(--ink-3)", fontSize: 13, padding: 20, textAlign: "center" }}>Cargando…</div>}
      {!loading && list.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 13, padding: "30px 10px", lineHeight: 1.6 }}>
          🎂 Agregá cumpleaños y te aviso ese día a la mañana.
        </div>
      )}
      {sorted.map(({ b, date, days, turns }) => (
        <button key={b.id} onClick={() => setSheet({ birthday: b })}
          style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: days === 0 ? "var(--hl-bg)" : "var(--surface)", border: `1.5px solid ${days === 0 ? "var(--hl-border)" : "var(--border)"}`, borderRadius: 13, padding: "10px 12px", cursor: "pointer", fontFamily: "inherit", color: "var(--ink)" }}>
          <span style={{ fontSize: 20 }}>🎂</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{b.name}</span>
            <span style={{ display: "block", fontFamily: "monospace", fontSize: 10.5, color: "var(--ink-2)", marginTop: 2 }}>
              {b.day} de {MONTHS[b.month - 1]}{turns !== null ? ` · cumple ${turns}` : ""}
            </span>
          </span>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: days <= 7 ? "var(--warn)" : "var(--ink-3)", fontWeight: days <= 7 ? 700 : 400, whiteSpace: "nowrap" }}>
            {relativeDays(days)}
          </span>
        </button>
      ))}
      <button onClick={() => setSheet({})}
        style={{ background: "transparent", border: "1.5px dashed var(--border)", borderRadius: 13, padding: "10px", fontFamily: "inherit", fontSize: 13, color: "var(--ink-2)", cursor: "pointer", marginTop: 4 }}>
        + Agregar cumpleaños
      </button>
      {sheet && <BirthdaySheet key={sheet.birthday?.id || "new"} birthday={sheet.birthday} onSave={save} onDelete={remove} onClose={() => setSheet(null)} />}
    </div>
  );
}

// ─── VISTA ───────────────────────────────────────────────────
const SECTIONS = [["note", "📝 Notas"], ["idea", "💡 Ideas"], ["birthday", "🎂 Cumples"]];

export default function NotesView() {
  const [section, setSection] = useState("note");
  return (
    <>
      <div style={{ display: "flex", gap: 6, padding: "10px 14px 8px" }}>
        {SECTIONS.map(([k, label]) => (
          <button key={k} onClick={() => setSection(k)} style={{ ...CHIP(section === k), flex: 1 }}>{label}</button>
        ))}
      </div>
      {section === "birthday" ? <BirthdaysList /> : <NotesList key={section} kind={section} />}
    </>
  );
}
