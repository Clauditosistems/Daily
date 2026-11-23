// Eventos: cumpleaños, planes, citas. Fecha única, hora opcional y repetición anual opcional.
// No se marcan como hechos ni pasan de día. Con hora, el aviso es obligatorio (30 min antes por defecto).
import { useState } from "react";
import { parseYmd, birthdayOn, hhmm, FIELD, LABEL, CHIP, PRIMARY_BTN, TEXT_BTN, DANGER_BTN, ERROR_BOX, Sheet, Toggle, AutoTextarea } from "./ui";

export const NOTIFY_OPTIONS = [[0, "A la hora"], [15, "15 min antes"], [30, "30 min antes"], [60, "1 hora antes"], [120, "2 horas antes"], [1440, "1 día antes"]];
export const notifyLabel = m => (NOTIFY_OPTIONS.find(([v]) => v === m) || [null, `${m} min antes`])[1];

// Fechas en que cae un evento entre from y to (inclusive).
export function eventDates(e, from, to) {
  if (!e.yearly) return e.event_date >= from && e.event_date <= to ? [e.event_date] : [];
  const d = parseYmd(e.event_date);
  const out = [];
  for (let y = parseYmd(from).getFullYear(); y <= parseYmd(to).getFullYear(); y++) {
    const x = birthdayOn(d.getMonth() + 1, d.getDate(), y);
    if (x >= from && x <= to && x >= e.event_date) out.push(x);
  }
  return out;
}

// Todo lo que va al calendario: eventos + cumpleaños + planes (que ya existían), como una sola lista.
export function calendarItems({ events = [], birthdays = [], plans = [] }, from, to) {
  const items = [];
  events.forEach(e => eventDates(e, from, to).forEach(date => items.push({ kind: "event", id: e.id, date, time: e.event_time, title: e.title, detail: e.detail, ref: e })));
  birthdays.forEach(b => {
    for (let y = parseYmd(from).getFullYear(); y <= parseYmd(to).getFullYear(); y++) {
      const date = birthdayOn(b.month, b.day, y);
      if (date >= from && date <= to) items.push({ kind: "birthday", id: b.id, date, time: null, title: `Cumple de ${b.name}`, turns: b.year ? y - b.year : null, ref: b });
    }
  });
  plans.forEach(p => { if (p.note_date >= from && p.note_date <= to) items.push({ kind: "plan", id: p.id, date: p.note_date, time: p.remind_time, title: p.text, ref: p }); });
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "99").localeCompare(b.time || "99"));
}

export const itemIcon = k => (k === "birthday" ? "🎂" : k === "plan" ? "📅" : "📌");

export function EventSheet({ event, onSave, onDelete, onClose }) {
  const isNew = !event.id;
  const [title, setTitle]   = useState(event.title || "");
  const [detail, setDetail] = useState(event.detail || "");
  const [date, setDate]     = useState(event.event_date || "");
  const [time, setTime]     = useState(hhmm(event.event_time));
  const [yearly, setYearly] = useState(!!event.yearly);
  const [notify, setNotify] = useState(event.notify_before_minutes ?? 30);
  const [morning, setMorning] = useState(isNew ? true : event.notify_before_minutes != null);  // sin hora: aviso a la mañana
  const [error, setError]   = useState("");
  const [busy, setBusy]     = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const payload = () => ({
    title: title.trim(), detail: detail.trim() || null, event_date: date, event_time: time || null, yearly,
    notify_before_minutes: time ? notify : (morning ? 0 : null),
  });
  const dirty = isNew ? !!title.trim()
    : JSON.stringify(payload()) !== JSON.stringify({ title: event.title, detail: event.detail || null, event_date: event.event_date,
      event_time: event.event_time ? hhmm(event.event_time) : null, yearly: event.yearly, notify_before_minutes: event.notify_before_minutes });

  async function save() {
    if (busy) return;
    if (!title.trim()) return setError("Poné de qué se trata.");
    if (!date) return setError("Elegí la fecha.");
    setBusy(true); setError("");
    try { await onSave(payload()); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  function closeSaving() {
    if (busy) return;
    if (!dirty || !title.trim()) return onClose();
    save();
  }
  async function remove() {
    setBusy(true);
    try { await onDelete(event.id); onClose(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Sheet title={isNew ? "Nuevo evento" : "Evento"} onClose={closeSaving}>
      <AutoTextarea value={title} onChange={setTitle} autoFocus={isNew} aria-label="Evento" placeholder="Ej: Turno con el dentista" style={{ fontSize: 17, fontWeight: 500 }} />
      <AutoTextarea value={detail} onChange={setDetail} minRows={1} aria-label="Detalle del evento" placeholder="Detalle (opcional)" />
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 3 }}>
          <div style={LABEL}>Fecha</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="num" style={FIELD} />
        </div>
        <div style={{ flex: 2 }}>
          <div style={LABEL}>Hora (opcional)</div>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} className="num" style={FIELD} />
        </div>
      </div>
      {time ? (
        <div>
          <div style={LABEL}>Aviso</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {NOTIFY_OPTIONS.map(([v, l]) => <button key={v} onClick={() => setNotify(v)} style={CHIP(notify === v)}>{l}</button>)}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 6 }}>Con hora siempre te aviso.</div>
          <button onClick={() => setTime("")} style={{ ...TEXT_BTN, fontSize: 14, padding: "6px 0" }}>Quitar la hora</button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1, fontSize: 16 }}>Avisarme ese día<span style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>A la hora de la mañana de Ajustes.</span></span>
          <Toggle label="Avisarme ese día" checked={morning} onChange={setMorning} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ flex: 1, fontSize: 16 }}>Se repite todos los años<span style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>Para cumpleaños o aniversarios.</span></span>
        <Toggle label="Se repite todos los años" checked={yearly} onChange={setYearly} />
      </div>
      {error && <div style={ERROR_BOX}>{error}</div>}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {isNew
          ? <button onClick={onClose} style={{ ...TEXT_BTN, flex: 1, color: "var(--ink-2)" }}>Descartar</button>
          : confirmDel
            ? <span style={{ flex: 2, display: "flex", gap: 4 }}>
                <button onClick={remove} disabled={busy} style={{ ...DANGER_BTN, fontWeight: 600 }}>Sí, eliminar</button>
                <button onClick={() => setConfirmDel(false)} style={{ ...TEXT_BTN, color: "var(--ink-2)" }}>No</button>
              </span>
            : <button onClick={() => setConfirmDel(true)} disabled={busy} style={{ ...DANGER_BTN, flex: 1 }}>Eliminar</button>}
        <button onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, flex: 2, opacity: busy ? 0.6 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
      </div>
    </Sheet>
  );
}
