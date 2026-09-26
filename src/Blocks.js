import { useState, useEffect } from "react";
import {
  supabase, sendMagicLink, fetchBlocks, createBlocks, updateBlock, deleteBlock,
  blockErrorMessage, localTasksToMigrate, migrateLocalTasks,
} from "./supabase";

export const BLOCK_TYPE = {
  trabajo:  { label: "Trabajo",  icon: "💼", color: "#c0392b", bg: "#fdf1ee" },
  estudio:  { label: "Estudio",  icon: "📚", color: "#2563c4", bg: "#eef3fd" },
  facultad: { label: "Facultad", icon: "🎓", color: "#7c3aad", bg: "#f5eeff" },
  entreno:  { label: "Entreno",  icon: "🏋️", color: "#1a9460", bg: "#edf8f3" },
  ocio:     { label: "Ocio",     icon: "🎮", color: "#b8640a", bg: "#fdf6e8" },
  otro:     { label: "Otro",     icon: "✦",  color: "#5a5248", bg: "#f2f0ec" },
};

// day_of_week sigue Date.getDay() (0=domingo); la semana se muestra de lunes a domingo.
const DAYS = [
  [1, "Lunes", "L"], [2, "Martes", "M"], [3, "Miércoles", "X"], [4, "Jueves", "J"],
  [5, "Viernes", "V"], [6, "Sábado", "S"], [0, "Domingo", "D"],
];

// Postgres devuelve "09:00:00"; un bloque que termina a medianoche se guarda como 24:00.
const hhmm = t => (t || "").slice(0, 5);
const toMinutes = t => { const [h, m] = hhmm(t).split(":").map(Number); return h * 60 + m; };
const endForDb = t => (t === "00:00" ? "24:00" : t);
const endForInput = t => (hhmm(t) === "24:00" ? "00:00" : hhmm(t));

function durationLabel(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

const FIELD = {
  background: "#ede9e1", border: "1.5px solid #d8d2c6", borderRadius: 10,
  color: "#1a1814", fontFamily: "inherit", fontSize: 14, padding: "9px 12px", outline: "none", width: "100%", boxSizing: "border-box",
};
const LABEL = { fontFamily: "monospace", fontSize: 9.5, color: "#a09890", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6 };
const CHIP = (active, color = "#1a1814", bg = "#1a1814") => ({
  flexShrink: 0, padding: "6px 11px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit", fontSize: 12,
  border: `1.5px solid ${active ? color : "#d8d2c6"}`, background: active ? bg : "transparent",
  color: active ? (bg === "#1a1814" ? "#f5f2ec" : color) : "#6b6457", fontWeight: active ? 700 : 500,
});
const PRIMARY_BTN = { background: "#1a1814", color: "#f5f2ec", border: "none", borderRadius: 12, padding: "12px 16px", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const GHOST_BTN = { background: "transparent", color: "#1a1814", border: "1.5px solid #d8d2c6", borderRadius: 12, padding: "11px 16px", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" };

// ─── LOGIN ───────────────────────────────────────────────────
function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent]   = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy]   = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setError("");
    try { await sendMagicLink(email.trim()); setSent(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: "40px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 28 }}>🗓</div>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.5px" }}>Tu semana</div>
      <div style={{ fontSize: 13, color: "#6b6457", lineHeight: 1.6 }}>
        Los bloques se guardan en la nube para poder avisarte aunque la app esté cerrada. Entrá con tu mail: te llega un link, lo tocás y listo.
      </div>
      {sent
        ? <div style={{ background: "#edf8f3", border: "1.5px solid #1a9460", color: "#1a9460", borderRadius: 12, padding: "12px 14px", fontSize: 13, lineHeight: 1.5 }}>
            Te mandamos un link a <b>{email}</b>. Abrilo desde este mismo dispositivo.
          </div>
        : <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@mail.com" style={FIELD} autoComplete="email" />
            <button type="submit" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.6 : 1 }}>{busy ? "Enviando…" : "Mandarme el link"}</button>
          </form>}
      {error && <div style={{ color: "#c0392b", fontSize: 12 }}>{error}</div>}
    </div>
  );
}

// ─── EDITOR DE BLOQUE (bottom sheet) ─────────────────────────
function BlockSheet({ block, defaultDay, onSave, onDelete, onClose }) {
  const isNew = !block;
  const [blockType, setBlockType] = useState(block?.block_type || "trabajo");
  const [label, setLabel]         = useState(block?.label || "");
  const [start, setStart]         = useState(hhmm(block?.start_time) || "09:00");
  const [end, setEnd]             = useState(block ? endForInput(block.end_time) : "10:00");
  const [floating, setFloating]   = useState(block?.floating ?? defaultDay === 0);
  const [days, setDays]           = useState(block ? [block.day_of_week] : [defaultDay]);
  const [error, setError]         = useState("");
  const [busy, setBusy]           = useState(false);

  function toggleDay(d) {
    if (!isNew) return setDays([d]);  // al editar, el bloque vive en un solo día
    setDays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d]);
  }

  async function save() {
    const endDb = endForDb(end);
    if (!days.length) return setError("Elegí al menos un día.");
    if (toMinutes(endDb) <= toMinutes(start)) return setError("El horario de fin tiene que ser posterior al de inicio.");
    setBusy(true); setError("");
    try {
      await onSave({ block_type: blockType, label: label.trim() || null, start_time: start, end_time: endDb, floating }, days);
      onClose();
    } catch (err) {
      setError(blockErrorMessage(err));
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try { await onDelete(block.id); onClose(); }
    catch (err) { setError(blockErrorMessage(err)); setBusy(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: "22px 22px 0 0", padding: "20px 20px 34px", width: "100%", maxWidth: 520, boxShadow: "0 -8px 40px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ width: 36, height: 4, background: "#d8d2c6", borderRadius: 2, margin: "0 auto" }} />
        <div style={{ fontSize: 16, fontWeight: 800 }}>{isNew ? "Nuevo bloque" : "Editar bloque"}</div>

        <div>
          <div style={LABEL}>Tipo</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(BLOCK_TYPE).map(([k, t]) => (
              <button key={k} onClick={() => setBlockType(k)} style={CHIP(blockType === k, t.color, t.bg)}>{t.icon} {t.label}</button>
            ))}
          </div>
        </div>

        <div>
          <div style={LABEL}>Nombre (opcional)</div>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder={BLOCK_TYPE[blockType].label} style={FIELD} maxLength={60} />
        </div>

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

        <div>
          <div style={LABEL}>{isNew ? "Días (podés elegir varios)" : "Día"}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {DAYS.map(([n, name, short]) => (
              <button key={n} onClick={() => toggleDay(n)} title={name}
                style={{ ...CHIP(days.includes(n)), width: 38, height: 38, padding: 0, borderRadius: "50%" }}>{short}</button>
            ))}
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={floating} onChange={e => setFloating(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16 }} />
          <span style={{ fontSize: 13, lineHeight: 1.45 }}>
            <b>Horario flexible</b>
            <span style={{ display: "block", color: "#a09890", fontSize: 12 }}>El horario es aproximado y puede pisarse con otros bloques. Ideal para el domingo.</span>
          </span>
        </label>

        {error && <div style={{ background: "#fdf1ee", color: "#c0392b", borderRadius: 10, padding: "9px 12px", fontSize: 12.5 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          {!isNew && <button onClick={remove} disabled={busy} style={{ ...GHOST_BTN, color: "#c0392b", borderColor: "#f0c8c0" }}>🗑</button>}
          <button onClick={onClose} style={{ ...GHOST_BTN, flex: 1 }}>Cancelar</button>
          <button onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, flex: 2, opacity: busy ? 0.6 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── FILA DE BLOQUE ──────────────────────────────────────────
function BlockRow({ block, onTap }) {
  const t = BLOCK_TYPE[block.block_type] || BLOCK_TYPE.otro;
  return (
    <button onClick={() => onTap(block)}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: t.bg, border: "none", borderLeft: `4px ${block.floating ? "dashed" : "solid"} ${t.color}`, borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontFamily: "inherit" }}>
      <span style={{ fontSize: 16 }}>{t.icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "#1a1814", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{block.label || t.label}</span>
        {block.floating && <span style={{ fontFamily: "monospace", fontSize: 9, color: t.color, fontWeight: 700, letterSpacing: "0.5px" }}>~ FLEXIBLE</span>}
      </span>
      <span style={{ fontFamily: "monospace", fontSize: 11.5, color: "#5a5248", whiteSpace: "nowrap" }}>
        {block.floating ? "~" : ""}{hhmm(block.start_time)}–{hhmm(block.end_time)}
      </span>
    </button>
  );
}

// ─── CUENTA + MIGRACIÓN ──────────────────────────────────────
function AccountFooter({ session }) {
  const [pending, setPending] = useState(null);
  const [status, setStatus]   = useState("");
  const [busy, setBusy]       = useState(false);

  useEffect(() => { localTasksToMigrate().then(t => setPending(t.length)).catch(() => setPending(0)); }, []);

  async function migrate() {
    setBusy(true); setStatus("");
    try {
      const n = await migrateLocalTasks();
      setStatus(`✓ ${n} tarea${n === 1 ? "" : "s"} subida${n === 1 ? "" : "s"}.`);
    } catch (err) { setStatus(`Error: ${err.message}`); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8, borderTop: "1px solid #d8d2c6", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      {pending > 0 && (
        <div style={{ background: "#fff", border: "1.5px solid #d8d2c6", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            Hay <b>{pending}</b> tarea{pending === 1 ? "" : "s"} con fecha en este dispositivo. Subilas a la nube para verlas en el calendario (los adjuntos no se suben).
          </div>
          <button onClick={migrate} disabled={busy} style={{ ...GHOST_BTN, opacity: busy ? 0.6 : 1 }}>{busy ? "Subiendo…" : "Subir tareas"}</button>
          {status && <div style={{ fontSize: 12, color: status.startsWith("Error") ? "#c0392b" : "#1a9460" }}>{status}</div>}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5, color: "#a09890" }}>
        <span>{session.user.email}</span>
        <button onClick={() => supabase.auth.signOut()} style={{ background: "none", border: "none", color: "#a09890", fontSize: 11.5, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>Salir</button>
      </div>
    </div>
  );
}

// ─── VISTA PRINCIPAL ─────────────────────────────────────────
export default function BlocksView({ session }) {
  const [blocks, setBlocks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [sheet, setSheet]     = useState(null);  // { block } o { day }

  useEffect(() => {
    if (!session) return;
    fetchBlocks().then(setBlocks).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, [session]);

  if (!session) return <Login />;

  async function handleSave(changes, days) {
    if (sheet.block) {
      const updated = await updateBlock(sheet.block.id, { ...changes, day_of_week: days[0] });
      setBlocks(p => p.map(b => b.id === updated.id ? updated : b));
    } else {
      const created = await createBlocks(changes, days);
      setBlocks(p => [...p, ...created]);
    }
  }

  async function handleDelete(id) {
    await deleteBlock(id);
    setBlocks(p => p.filter(b => b.id !== id));
  }

  const byDay = Object.fromEntries(DAYS.map(([n]) => [n, []]));
  blocks.forEach(b => byDay[b.day_of_week]?.push(b));
  Object.values(byDay).forEach(list => list.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time)));

  const weekMinutes = blocks.filter(b => !b.floating).reduce((s, b) => s + toMinutes(b.end_time) - toMinutes(b.start_time), 0);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px 40px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 2px" }}>
        <div style={{ fontSize: 13, color: "#6b6457" }}>Tu semana tipo. Se repite todas las semanas.</div>
        {weekMinutes > 0 && <div style={{ fontFamily: "monospace", fontSize: 10.5, color: "#a09890" }}>{durationLabel(weekMinutes)}/sem</div>}
      </div>

      {error && <div style={{ background: "#fdf1ee", color: "#c0392b", borderRadius: 10, padding: "9px 12px", fontSize: 12.5 }}>{error}</div>}
      {loading && <div style={{ color: "#a09890", fontSize: 13, padding: 20, textAlign: "center" }}>Cargando…</div>}

      {!loading && DAYS.map(([n, name]) => {
        const list = byDay[n];
        const minutes = list.filter(b => !b.floating).reduce((s, b) => s + toMinutes(b.end_time) - toMinutes(b.start_time), 0);
        return (
          <div key={n} style={{ background: "#fff", border: "1.5px solid #d8d2c6", borderRadius: 15, padding: "11px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{name}</span>
              {minutes > 0 && <span style={{ fontFamily: "monospace", fontSize: 10, color: "#a09890" }}>{durationLabel(minutes)}</span>}
            </div>
            {list.length === 0 && <div style={{ fontSize: 12, color: "#a09890" }}>{n === 0 ? "Día libre. Podés sumar bloques flexibles." : "Sin bloques."}</div>}
            {list.map(b => <BlockRow key={b.id} block={b} onTap={block => setSheet({ block })} />)}
            <button onClick={() => setSheet({ day: n })}
              style={{ background: "transparent", border: "1.5px dashed #d8d2c6", borderRadius: 10, padding: "7px", fontFamily: "inherit", fontSize: 12, color: "#6b6457", cursor: "pointer" }}>
              + Agregar bloque
            </button>
          </div>
        );
      })}

      <AccountFooter session={session} />

      {sheet && (
        <BlockSheet
          key={sheet.block?.id || `new-${sheet.day}`}
          block={sheet.block}
          defaultDay={sheet.day ?? sheet.block?.day_of_week}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
