import { useState, useRef, useEffect } from "react";
import { db } from "./db";
import { requestPermission, registerSW, scheduleDeadlineCheck, checkAndNotifyToday } from "./notifications";

const CTX = {
  work:     { label: "Trabajo",  icon: "💼", accent: "#c0392b", bg: "#fdf1ee", fg: "#c0392b" },
  study:    { label: "Estudio",  icon: "📚", accent: "#2563c4", bg: "#eef3fd", fg: "#2563c4" },
  personal: { label: "Personal", icon: "🙋", accent: "#7c3aad", bg: "#f5eeff", fg: "#7c3aad" },
  home:     { label: "Casa",     icon: "🏠", accent: "#1a9460", bg: "#edf8f3", fg: "#1a9460" },
  today:    { label: "Hoy",      icon: "📋", accent: "#b8640a", bg: "#fdf6e8", fg: "#b8640a" },
};
const TYPE = {
  task: { label: "Tarea", icon: "✅" },
  note: { label: "Nota",  icon: "📝" },
  idea: { label: "Idea",  icon: "💡" },
  plan: { label: "Plan",  icon: "🗓" },
};
const PRIO = {
  high: { label: "Alta",  color: "#c0392b", ring: "rgba(192,57,43,0.22)" },
  mid:  { label: "Media", color: "#e6b800", ring: "rgba(230,184,0,0.25)" }, // amarillo puro
  low:  { label: "Baja",  color: "#1a9460", ring: "rgba(26,148,96,0.22)"  },
};
const TYPE_TAG = {
  task: { bg: "#f2f0ec", fg: "#3a3530" },
  note: { bg: "#f0f0ee", fg: "#5a5248" },
  idea: { bg: "#fdf4e3", fg: "#8a5800" },
  plan: { bg: "#edf2fc", fg: "#1e5fa8" },
};
const MAX_ATTACH_MB = 8;

// ─── HELPERS ─────────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function deadlineInfo(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const diff = Math.round((target - now) / 86400000);
  let label =
    diff < 0  ? `⚠ Vencida hace ${Math.abs(diff)}d` :
    diff === 0 ? "Hoy" :
    diff === 1 ? "Mañana" :
    target.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  if (timeStr) label += ` ${timeStr}`;
  return { label, overdue: diff < 0, isToday: diff === 0 };
}

function calcStreak(history) {
  if (!history.length) return 0;
  const days = [...new Set(history.map(i => i.completedDate))].sort().reverse();
  let streak = 0;
  const today = new Date(); today.setHours(0,0,0,0);
  let check = new Date(today);
  for (const day of days) {
    const checkStr = `${check.getFullYear()}-${String(check.getMonth()+1).padStart(2,"0")}-${String(check.getDate()).padStart(2,"0")}`;
    if (day === checkStr) { streak++; check.setDate(check.getDate() - 1); } else break;
  }
  return streak;
}

function fileToDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

function dayLabel(ds) {
  const [y, m, d] = ds.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const diff = Math.round((t - now) / 86400000);
  if (diff === 0)  return "Hoy";
  if (diff === -1) return "Ayer";
  return t.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
}

// Resumen por tipo para historial
function typeSummary(items) {
  const counts = {};
  items.forEach(i => { counts[i.type] = (counts[i.type] || 0) + 1; });
  return Object.entries(counts)
    .map(([k, n]) => `${TYPE[k]?.icon} ${n} ${TYPE[k]?.label}${n > 1 ? "s" : ""}`)
    .join("  ·  ");
}

// ─── ESTILOS BASE ────────────────────────────────────────────
const INPUT_STYLE = {
  background: "#ede9e1", border: "1.5px solid #d8d2c6", borderRadius: 10,
  color: "#1a1814", fontFamily: "inherit", fontSize: 11.5,
  padding: "6px 22px 6px 8px", outline: "none", appearance: "none", cursor: "pointer",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23a09890'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
};
const DATE_STYLE = {
  background: "#ede9e1", border: "1.5px solid #d8d2c6", borderRadius: 10,
  color: "#1a1814", fontFamily: "monospace", fontSize: 11, padding: "6px 10px", outline: "none",
};
const TAG_STYLE = (bg, fg) => ({
  display: "inline-flex", alignItems: "center", gap: 3,
  background: bg, color: fg, fontFamily: "monospace", fontSize: 9, fontWeight: 600,
  padding: "2px 7px", borderRadius: 6, letterSpacing: "0.5px", textTransform: "uppercase",
});
const MENU_BTN = (danger = false) => ({
  background: "transparent", border: "none", color: danger ? "#c0392b" : "#1a1814",
  fontFamily: "inherit", fontSize: 13, padding: "9px 14px", borderRadius: 8,
  cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 9, width: "100%",
});

// ─── DETAIL MODAL (tap en tarjeta) ───────────────────────────
function DetailModal({ item, onClose, onEdit, onComplete, onDelete }) {
  const dl = deadlineInfo(item.deadline, item.time);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: "22px 22px 0 0", padding: "20px 20px 40px", width: "100%", maxWidth: 520, boxShadow: "0 -8px 40px rgba(0,0,0,0.15)", maxHeight: "85vh", overflowY: "auto" }}>
        {/* handle bar */}
        <div style={{ width: 36, height: 4, background: "#d8d2c6", borderRadius: 2, margin: "0 auto 18px" }} />

        {/* tags + prio */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={TAG_STYLE(CTX[item.ctx]?.bg, CTX[item.ctx]?.fg)}>{CTX[item.ctx]?.icon} {CTX[item.ctx]?.label}</span>
          <span style={TAG_STYLE(TYPE_TAG[item.type]?.bg, TYPE_TAG[item.type]?.fg)}>{TYPE[item.type]?.icon} {TYPE[item.type]?.label}</span>
          <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: PRIO[item.prio]?.color, marginLeft: 2 }}>
            ● {PRIO[item.prio]?.label}
          </span>
          {item.done && <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 10, color: "#1a9460", fontWeight: 700 }}>✓ Completada</span>}
        </div>

        {/* text */}
        <div style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.55, color: "#1a1814", marginBottom: 16, wordBreak: "break-word", textDecoration: item.done ? "line-through" : "none" }}>
          {item.text}
        </div>

        {/* deadline */}
        {dl && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "8px 12px", background: dl.overdue ? "#fdf1ee" : dl.isToday ? "#fdf6e8" : "#f5f2ec", borderRadius: 10 }}>
            <span style={{ fontSize: 14 }}>📅</span>
            <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: dl.overdue ? "#c0392b" : dl.isToday ? "#b8640a" : "#5a5248" }}>{dl.label}</span>
          </div>
        )}

        {/* attachments */}
        {item.attachments?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontFamily: "monospace", color: "#a09890", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8 }}>Adjuntos</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {item.attachments.map((a, i) =>
                a.type?.startsWith("image/")
                  ? <img key={i} src={a.data} alt={a.name} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 10, border: "1px solid #d8d2c6", cursor: "pointer" }} onClick={() => window.open(a.data)} />
                  : <a key={i} href={a.data} download={a.name} style={{ display: "flex", alignItems: "center", gap: 5, background: "#f5f2ec", border: "1px solid #d8d2c6", borderRadius: 10, padding: "6px 10px", fontSize: 12, color: "#1a1814", textDecoration: "none" }}>
                      📎 {a.name}
                    </a>
              )}
            </div>
          </div>
        )}

        {/* meta */}
        <div style={{ fontFamily: "monospace", fontSize: 10, color: "#a09890", marginBottom: 20 }}>
          Creada: {new Date(item.ts).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          {item.completedAt && ` · Completada: ${new Date(item.completedAt).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
        </div>

        {/* actions */}
        <div style={{ display: "flex", gap: 8 }}>
          {!item.done && (
            <button onClick={() => { onComplete(item.id); onClose(); }}
              style={{ flex: 1, background: "#edf8f3", border: "1.5px solid #1a9460", color: "#1a9460", borderRadius: 12, padding: "11px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              ✓ Completar
            </button>
          )}
          <button onClick={() => { onEdit(item.id); onClose(); }}
            style={{ flex: 1, background: "#f5f2ec", border: "1.5px solid #d8d2c6", color: "#1a1814", borderRadius: 12, padding: "11px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            ✏️ Editar
          </button>
          <button onClick={() => { onDelete(item.id); onClose(); }}
            style={{ background: "#fdf1ee", border: "1.5px solid #c0392b", color: "#c0392b", borderRadius: 12, padding: "11px 14px", fontSize: 14, cursor: "pointer" }}>
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ATTACHMENT PREVIEW ───────────────────────────────────────
function AttachPreview({ attachments }) {
  if (!attachments?.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 }}>
      {attachments.map((a, i) =>
        a.type?.startsWith("image/")
          ? <img key={i} src={a.data} alt={a.name} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, border: "1px solid #d8d2c6", cursor: "pointer" }} onClick={e => { e.stopPropagation(); window.open(a.data); }} />
          : <a key={i} href={a.data} download={a.name} onClick={e => e.stopPropagation()}
              style={{ display: "flex", alignItems: "center", gap: 4, background: "#f5f2ec", border: "1px solid #d8d2c6", borderRadius: 8, padding: "4px 8px", fontSize: 11, color: "#1a1814", textDecoration: "none", maxWidth: 130 }}>
              📎 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
            </a>
      )}
    </div>
  );
}

// ─── EDIT MODAL ───────────────────────────────────────────────
function EditModal({ item, onSave, onClose }) {
  const [text, setText] = useState(item.text);
  const [ctx,  setCtx]  = useState(item.ctx);
  const [type, setType] = useState(item.type);
  const [prio, setPrio] = useState(item.prio);
  const [date, setDate] = useState(item.deadline || "");
  const [time, setTime] = useState(item.time || "");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "20px 18px 36px", width: "100%", maxWidth: 520, boxShadow: "0 -8px 40px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Editar entrada</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#a09890" }}>✕</button>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)}
          style={{ width: "100%", background: "#f5f2ec", border: "1.5px solid #d8d2c6", borderRadius: 12, padding: "10px 12px", fontFamily: "inherit", fontSize: 14, resize: "none", minHeight: 80, outline: "none", marginBottom: 10, color: "#1a1814", boxSizing: "border-box" }} />
        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={ctx}  onChange={e => setCtx(e.target.value)}  style={{ ...INPUT_STYLE, flex: 1, minWidth: 90 }}>
            {Object.entries(CTX).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)} style={{ ...INPUT_STYLE, flex: 1, minWidth: 90 }}>
            {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
          <select value={prio} onChange={e => setPrio(e.target.value)} style={{ ...INPUT_STYLE, flex: "0 0 auto", minWidth: 86 }}>
            <option value="high">🔴 Alta</option>
            <option value="mid">🟡 Media</option>
            <option value="low">🟢 Baja</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...DATE_STYLE, flex: 1 }} />
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...DATE_STYLE, maxWidth: 110 }} />
        </div>
        <button onClick={() => onSave({ text, ctx, type, prio, deadline: date || null, time: time || null })}
          style={{ width: "100%", background: "#1a1814", color: "#f5f2ec", border: "none", borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          Guardar cambios
        </button>
      </div>
    </div>
  );
}

// ─── CARD MENU ────────────────────────────────────────────────
function CardMenu({ item, onEdit, onComplete, onDelete, onMoveCtx, onMoveType, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <div ref={ref} style={{ position: "absolute", right: 0, bottom: 34, background: "#fff", border: "1.5px solid #d8d2c6", borderRadius: 13, padding: 6, zIndex: 100, minWidth: 175, boxShadow: "0 8px 32px rgba(0,0,0,0.13)" }}>
      <button style={MENU_BTN()} onClick={() => { onEdit(); onClose(); }}>✏️ Editar</button>
      <button style={MENU_BTN()} onClick={() => { onComplete(); onClose(); }}>{item.done ? "🔄 Marcar pendiente" : "✅ Marcar completada"}</button>
      <div style={{ height: 1, background: "#ede9e1", margin: "3px 6px" }} />
      <div style={{ fontSize: 9, fontFamily: "monospace", color: "#a09890", padding: "5px 14px 2px", textTransform: "uppercase", letterSpacing: "0.8px" }}>Mover a</div>
      {Object.entries(CTX).filter(([k]) => k !== item.ctx).map(([k, v]) => (
        <button key={k} style={MENU_BTN()} onClick={() => { onMoveCtx(k); onClose(); }}>{v.icon} {v.label}</button>
      ))}
      <div style={{ height: 1, background: "#ede9e1", margin: "3px 6px" }} />
      <div style={{ fontSize: 9, fontFamily: "monospace", color: "#a09890", padding: "5px 14px 2px", textTransform: "uppercase", letterSpacing: "0.8px" }}>Tipo</div>
      {Object.entries(TYPE).filter(([k]) => k !== item.type).map(([k, v]) => (
        <button key={k} style={MENU_BTN()} onClick={() => { onMoveType(k); onClose(); }}>{v.icon} {v.label}</button>
      ))}
      <div style={{ height: 1, background: "#ede9e1", margin: "3px 6px" }} />
      <button style={MENU_BTN(true)} onClick={() => { onDelete(); onClose(); }}>🗑 Eliminar</button>
    </div>
  );
}

// ─── CARD ─────────────────────────────────────────────────────
function Card({ item, onComplete, onEdit, onDelete, onMoveCtx, onMoveType, onTap }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const completing = useRef(false);
  const dl = deadlineInfo(item.deadline, item.time);
  const createdTime = new Date(item.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  function handleComplete(e) {
    e.stopPropagation();
    if (completing.current) return;
    completing.current = true;
    onComplete(item.id);
    setTimeout(() => { completing.current = false; }, 800);
  }

  // texto completo visible
  const textStyle = {
    fontSize: 14, lineHeight: 1.5, color: item.done ? "#a09890" : "#1a1814",
    marginBottom: 8, wordBreak: "break-word",
    textDecoration: item.done ? "line-through" : "none",
  };

  return (
    <div onClick={() => !menuOpen && onTap(item)}
      style={{ background: "#fff", border: "1.5px solid #d8d2c6", borderRadius: 15, padding: "11px 12px 10px 16px", position: "relative", opacity: item.done ? 0.44 : 1, overflow: "hidden", cursor: "pointer" }}>
      <div style={{ position: "absolute", left: 0, top: "12%", bottom: "12%", width: 3, borderRadius: "0 2px 2px 0", background: CTX[item.ctx]?.accent || "#ccc" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 7, flexWrap: "wrap" }}>
        <span style={TAG_STYLE(CTX[item.ctx]?.bg, CTX[item.ctx]?.fg)}>{CTX[item.ctx]?.icon} {CTX[item.ctx]?.label}</span>
        <span style={TAG_STYLE(TYPE_TAG[item.type]?.bg, TYPE_TAG[item.type]?.fg)}>{TYPE[item.type]?.icon} {TYPE[item.type]?.label}</span>
        <div style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: PRIO[item.prio]?.color, boxShadow: `0 0 0 3px ${PRIO[item.prio]?.ring}` }} title={PRIO[item.prio]?.label} />
      </div>
      <AttachPreview attachments={item.attachments} />
      <div style={textStyle}>{item.text}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {dl && <span style={{ fontFamily: "monospace", fontSize: 9.5, fontWeight: 500, color: dl.overdue ? "#c0392b" : dl.isToday ? "#b8640a" : "#7a9ab0" }}>📅 {dl.label}</span>}
        <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 9, color: "#b0a898" }}>{createdTime}</span>
        {!item.done && (
          <button onClick={handleComplete} title="Completar"
            style={{ background: "#edf8f3", border: "1.5px solid #1a9460", color: "#1a9460", borderRadius: 8, width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontWeight: 700 }}>
            ✓
          </button>
        )}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
            style={{ background: "#ede9e1", border: "1px solid #d8d2c6", color: "#6b6457", borderRadius: 8, width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
            ⋯
          </button>
          {menuOpen && (
            <CardMenu item={item}
              onEdit={() => onEdit(item.id)} onComplete={() => onComplete(item.id)}
              onDelete={() => onDelete(item.id)} onMoveCtx={k => onMoveCtx(item.id, k)}
              onMoveType={k => onMoveType(item.id, k)} onClose={() => setMenuOpen(false)} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── HISTORY CARD ─────────────────────────────────────────────
function HistCard({ item }) {
  const dl = deadlineInfo(item.deadline, item.time);
  const t = new Date(item.completedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div style={{ background: "#fff", border: "1.5px solid #d8d2c6", borderRadius: 14, padding: "10px 13px", opacity: 0.72, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: "12%", bottom: "12%", width: 3, borderRadius: "0 2px 2px 0", background: CTX[item.ctx]?.accent || "#ccc" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, flexWrap: "wrap" }}>
        <span style={TAG_STYLE(CTX[item.ctx]?.bg, CTX[item.ctx]?.fg)}>{CTX[item.ctx]?.icon} {CTX[item.ctx]?.label}</span>
        <span style={TAG_STYLE(TYPE_TAG[item.type]?.bg, TYPE_TAG[item.type]?.fg)}>{TYPE[item.type]?.icon} {TYPE[item.type]?.label}</span>
        <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 9, color: "#1a9460", fontWeight: 700 }}>✓ {t}</span>
      </div>
      <div style={{ fontSize: 13, color: "#5a5248", textDecoration: "line-through", lineHeight: 1.45, marginBottom: dl ? 4 : 0 }}>{item.text}</div>
      {dl && <span style={{ fontFamily: "monospace", fontSize: 9, color: "#a09890" }}>📅 {dl.label}</span>}
    </div>
  );
}

// ─── COLLAPSIBLE HISTORY DAY ──────────────────────────────────
function HistoryDay({ day, items }) {
  const [open, setOpen] = useState(day === todayStr());
  const summary = typeSummary(items);
  const label = dayLabel(day);
  return (
    <div style={{ marginBottom: 4 }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ width: "100%", background: "#fff", border: "1.5px solid #d8d2c6", borderRadius: open ? "13px 13px 0 0" : 13, padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: "#1a1814", marginBottom: 3 }}>{label}</div>
          <div style={{ fontFamily: "monospace", fontSize: 10, color: "#7a9ab0" }}>{summary}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "#a09890" }}>{items.length} total</span>
          <span style={{ color: "#a09890", fontSize: 12, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>▾</span>
        </div>
      </button>
      {open && (
        <div style={{ border: "1.5px solid #d8d2c6", borderTop: "none", borderRadius: "0 0 13px 13px", padding: "8px 8px", display: "flex", flexDirection: "column", gap: 6, background: "#faf9f6" }}>
          {items.map(i => <HistCard key={i.id + day} item={i} />)}
        </div>
      )}
    </div>
  );
}

// ─── COMPOSE ─────────────────────────────────────────────────
function Compose({ onSend }) {
  const [text, setText]         = useState("");
  const [ctx, setCtx]           = useState("work");
  const [type, setType]         = useState("task");
  const [prio, setPrio]         = useState("mid");
  const [date, setDate]         = useState("");
  const [time, setTime]         = useState("");
  const [showDate, setShowDate] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachError, setAttachError] = useState("");
  const textRef = useRef();
  const fileRef = useRef();

  async function handleFiles(e) {
    const files = Array.from(e.target.files);
    setAttachError("");
    const results = [];
    for (const f of files) {
      if (f.size > MAX_ATTACH_MB * 1024 * 1024) { setAttachError(`"${f.name}" supera el límite de ${MAX_ATTACH_MB}MB`); continue; }
      results.push({ name: f.name, type: f.type, data: await fileToDataURL(f) });
    }
    setAttachments(prev => [...prev, ...results]);
    e.target.value = "";
  }

  function send() {
    if (!text.trim() && !attachments.length) return;
    onSend({ text: text.trim(), ctx, type, prio, deadline: date || null, time: time || null, attachments });
    setText(""); setAttachments([]); setAttachError("");
    if (textRef.current) textRef.current.style.height = "auto";
  }

  return (
    <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 520, background: "#fff", borderTop: "1.5px solid #d8d2c6", padding: "10px 14px 28px", zIndex: 40, boxShadow: "0 -4px 24px rgba(0,0,0,0.08)" }}>
      <div style={{ display: "flex", gap: 5, marginBottom: 7, flexWrap: "wrap" }}>
        <select value={ctx}  onChange={e => setCtx(e.target.value)}  style={{ ...INPUT_STYLE, flex: 1, minWidth: 82 }}>
          {Object.entries(CTX).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <select value={type} onChange={e => setType(e.target.value)} style={{ ...INPUT_STYLE, flex: 1, minWidth: 82 }}>
          {Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <select value={prio} onChange={e => setPrio(e.target.value)} style={{ ...INPUT_STYLE, flex: "0 0 auto", minWidth: 86 }}>
          <option value="high">🔴 Alta</option>
          <option value="mid">🟡 Media</option>
          <option value="low">🟢 Baja</option>
        </select>
      </div>
      {showDate && (
        <div style={{ display: "flex", gap: 6, marginBottom: 7 }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...DATE_STYLE, flex: 1 }} />
          <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ ...DATE_STYLE, maxWidth: 110 }} />
        </div>
      )}
      {attachments.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 }}>
          {attachments.map((a, i) => (
            <div key={i} style={{ position: "relative" }}>
              {a.type?.startsWith("image/")
                ? <img src={a.data} alt={a.name} style={{ width: 50, height: 50, objectFit: "cover", borderRadius: 8, border: "1px solid #d8d2c6" }} />
                : <div style={{ background: "#f5f2ec", border: "1px solid #d8d2c6", borderRadius: 8, padding: "4px 8px", fontSize: 10, color: "#1a1814", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📎 {a.name}</div>
              }
              <button onClick={() => setAttachments(p => p.filter((_, j) => j !== i))}
                style={{ position: "absolute", top: -5, right: -5, background: "#c0392b", border: "none", borderRadius: "50%", width: 16, height: 16, color: "#fff", fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
          ))}
        </div>
      )}
      {attachError && <div style={{ fontSize: 11, color: "#c0392b", marginBottom: 6 }}>⚠ {attachError}</div>}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        <button onClick={() => { setShowDate(v => !v); if (showDate) { setDate(""); setTime(""); } }}
          style={{ background: showDate ? "#1a1814" : "#ede9e1", color: showDate ? "#f5f2ec" : "#6b6457", border: `1.5px solid ${showDate ? "#1a1814" : "#d8d2c6"}`, borderRadius: 10, padding: "0 10px", height: 38, fontSize: 14, cursor: "pointer", flexShrink: 0 }}>📅</button>
        <button onClick={() => fileRef.current?.click()}
          style={{ background: "#ede9e1", border: "1.5px solid #d8d2c6", color: "#6b6457", borderRadius: 10, padding: "0 10px", height: 38, fontSize: 14, cursor: "pointer", flexShrink: 0 }}>📎</button>
        <input ref={fileRef} type="file" multiple onChange={handleFiles} style={{ display: "none" }} />
        <div style={{ flex: 1, background: "#ede9e1", border: "1.5px solid #d8d2c6", borderRadius: 13, padding: "7px 12px", display: "flex", alignItems: "flex-end" }}>
          <textarea ref={textRef} value={text}
            onChange={e => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Escribí y Enter…" rows={1}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#1a1814", fontFamily: "inherit", fontSize: 14, resize: "none", minHeight: 24, maxHeight: 90, lineHeight: 1.4, padding: 0, width: "100%" }} />
        </div>
        <button onClick={send}
          style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "#1a1814", color: "#f5f2ec", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>↑</button>
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────
export default function App() {
  const [items,    setItems]   = useState([]);
  const [history,  setHistory] = useState([]);
  const [view,     setView]    = useState("inbox");
  const [filter,   setFilter]  = useState("all");
  const [typeFilter, setTypeFilter] = useState("all"); // filtro por tipo
  const [editId,   setEditId]  = useState(null);
  const [detailItem, setDetailItem] = useState(null);
  const [loading,  setLoading] = useState(true);
  const [notifOk,  setNotifOk] = useState(false);

  useEffect(() => {
    registerSW();
    async function load() {
      try {
        const [its, hist] = await Promise.all([db.getItems(), db.getHistory()]);
        its.sort((a, b) => new Date(b.ts) - new Date(a.ts));
        hist.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
        setItems(its); setHistory(hist);
        if (Notification.permission === "granted") setNotifOk(true);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  async function handleNotifRequest() {
    const ok = await requestPermission();
    setNotifOk(ok);
    if (ok) checkAndNotifyToday(items);
  }

  async function addItem(data) {
    const item = { id: Date.now(), ...data, done: false, ts: new Date().toISOString() };
    await db.saveItem(item);
    setItems(p => [item, ...p]);
    scheduleDeadlineCheck([item, ...items]);
  }

  async function completeItem(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    if (item.done) {
      const updated = { ...item, done: false, completedAt: undefined, completedDate: undefined };
      await Promise.all([db.saveItem(updated), db.removeHistory(id)]);
      setItems(p => p.map(i => i.id === id ? updated : i));
      setHistory(p => p.filter(i => i.id !== id));
    } else {
      if (history.some(i => i.id === id)) return;
      const completedAt = new Date().toISOString(), completedDate = todayStr();
      const updated  = { ...item, done: true, completedAt, completedDate };
      await Promise.all([db.saveItem(updated), db.saveHistory({ ...item, done: true, completedAt, completedDate })]);
      setItems(p => p.map(i => i.id === id ? updated : i));
      setHistory(p => [{ ...item, done: true, completedAt, completedDate }, ...p]);
    }
  }

  async function saveEdit(id, data) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, ...data };
    await db.saveItem(updated);
    setItems(p => p.map(i => i.id === id ? updated : i));
    if (updated.done) {
      const histItem = history.find(h => h.id === id);
      if (histItem) { const uh = { ...histItem, ...data }; await db.saveHistory(uh); setHistory(p => p.map(i => i.id === id ? uh : i)); }
    }
    setEditId(null);
  }

  async function deleteItem(id) {
    await Promise.all([db.removeItem(id), db.removeHistory(id)]);
    setItems(p => p.filter(i => i.id !== id));
    setHistory(p => p.filter(i => i.id !== id));
  }

  async function moveCtx(id, ctx)   { const item = items.find(i => i.id === id); if (!item) return; const u = { ...item, ctx };  await db.saveItem(u); setItems(p => p.map(i => i.id === id ? u : i)); }
  async function moveType(id, type) { const item = items.find(i => i.id === id); if (!item) return; const u = { ...item, type }; await db.saveItem(u); setItems(p => p.map(i => i.id === id ? u : i)); }

  // ── DERIVADOS ──────────────────────────────────────────────
  const streak   = calcStreak(history);
  const today    = todayStr();

  // Filtro por contexto + tipo
  const counts = { all: 0, ...Object.fromEntries(Object.keys(CTX).map(k => [k, 0])) };
  items.filter(i => !i.done).forEach(i => { counts.all++; if (counts[i.ctx] !== undefined) counts[i.ctx]++; });

  const typeCounts = { all: 0, ...Object.fromEntries(Object.keys(TYPE).map(k => [k, 0])) };
  items.filter(i => !i.done && (filter === "all" || i.ctx === filter)).forEach(i => { typeCounts.all++; if (typeCounts[i.type] !== undefined) typeCounts[i.type]++; });

  const pending = items.filter(i =>
    !i.done &&
    (filter === "all" || i.ctx === filter) &&
    (typeFilter === "all" || i.type === typeFilter)
  );

  const dueToday  = items.filter(i => !i.done && i.deadline === today);
  const overdue   = items.filter(i => !i.done && i.deadline && i.deadline < today);
  const todayDone = history.filter(i => i.completedDate === today);

  const histByDay = {};
  history.forEach(i => { if (!histByDay[i.completedDate]) histByDay[i.completedDate] = []; histByDay[i.completedDate].push(i); });
  const histDays = Object.keys(histByDay).sort().reverse();

  const editItem_ = items.find(i => i.id === editId);
  const feedStyle = { flex: 1, overflowY: "auto", padding: "10px 14px 230px", display: "flex", flexDirection: "column", gap: 8 };
  const SECTION   = (label, color) => <div style={{ fontFamily: "monospace", fontSize: 9.5, color, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", padding: "6px 0 3px" }}>{label}</div>;

  if (loading) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh", background: "#f5f2ec", color: "#a09890", fontSize: 13 }}>Cargando…</div>;

  return (
    <div style={{ fontFamily: "'Segoe UI',system-ui,sans-serif", background: "#f5f2ec", height: "100dvh", display: "flex", flexDirection: "column", width: "100%", maxWidth: 520, margin: "0 auto", position: "relative", fontSize: 14, overflowX: "hidden" }}>

      {/* HEADER */}
      <div style={{ background: "#f5f2ec", padding: "14px 16px 0", position: "sticky", top: 0, zIndex: 30, borderBottom: "1px solid #d8d2c6" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.7px" }}>Daily</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {streak > 0 && <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#fff8ec", border: "1.5px solid #f0c060", borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, color: "#a07000" }}>🔥 {streak}d</div>}
            {!notifOk && <button onClick={handleNotifRequest} style={{ background: "#eef3fd", border: "1.5px solid #2563c4", color: "#2563c4", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🔔 Alertas</button>}
            <span style={{ fontFamily: "monospace", fontSize: 9, color: "#a09890" }}>{new Date().toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}</span>
          </div>
        </div>
        <div style={{ display: "flex" }}>
          {[["inbox","📥 Inbox"], ["hoy", `⚡ Hoy${dueToday.length + overdue.length > 0 ? ` (${dueToday.length + overdue.length})` : ""}`], ["historial","📜 Historial"]].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)}
              style={{ flex: 1, padding: "8px 4px", border: "none", background: "transparent", fontFamily: "inherit", fontSize: 12, fontWeight: view === v ? 700 : 500, color: view === v ? "#1a1814" : "#a09890", cursor: "pointer", borderBottom: `2px solid ${view === v ? "#1a1814" : "transparent"}`, transition: "all 0.15s" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* ── INBOX ── */}
      {view === "inbox" && <>
        {/* Filtro por contexto */}
        <div style={{ padding: "10px 14px 0", display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" }}>
          {[["all","✦","Todo"], ...Object.entries(CTX).map(([k, v]) => [k, v.icon, v.label])].map(([k, icon, label]) => {
            const isAct = filter === k;
            const fg = k === "all" ? "#f5f2ec" : CTX[k]?.fg || "#333";
            const bg = k === "all" ? "#1a1814" : CTX[k]?.bg || "#eee";
            const bd = k === "all" ? "#1a1814" : CTX[k]?.accent || "#d8d2c6";
            return (
              <button key={k} onClick={() => setFilter(k)}
                style={{ flexShrink: 0, padding: "5px 11px", borderRadius: 20, border: `1.5px solid ${isAct ? bd : "#d8d2c6"}`, background: isAct ? bg : "transparent", color: isAct ? fg : "#6b6457", fontFamily: "inherit", fontSize: 11.5, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
                {icon} {label}
                <span style={{ fontFamily: "monospace", fontSize: 9, borderRadius: 10, padding: "1px 5px", background: isAct ? (k === "all" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.07)") : "#ede9e1", color: isAct ? (k === "all" ? "rgba(255,255,255,0.85)" : fg) : "#a09890" }}>
                  {counts[k] || 0}
                </span>
              </button>
            );
          })}
        </div>
        {/* Filtro por tipo */}
        <div style={{ padding: "6px 14px 4px", display: "flex", gap: 5, overflowX: "auto", scrollbarWidth: "none" }}>
          {[["all","Todos"], ...Object.entries(TYPE).map(([k, v]) => [k, `${v.icon} ${v.label}s`])].map(([k, label]) => {
            const isAct = typeFilter === k;
            return (
              <button key={k} onClick={() => setTypeFilter(k)}
                style={{ flexShrink: 0, padding: "3px 10px", borderRadius: 14, border: `1.5px solid ${isAct ? "#1a1814" : "#d8d2c6"}`, background: isAct ? "#1a1814" : "transparent", color: isAct ? "#f5f2ec" : "#6b6457", fontFamily: "inherit", fontSize: 11, fontWeight: isAct ? 700 : 400, cursor: "pointer", whiteSpace: "nowrap" }}>
                {label}
                <span style={{ fontFamily: "monospace", fontSize: 9, marginLeft: 4, opacity: 0.7 }}>{typeCounts[k] || 0}</span>
              </button>
            );
          })}
        </div>

        <div style={feedStyle}>
          {pending.length === 0
            ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", color: "#a09890", gap: 8 }}>
                <div style={{ fontSize: 28 }}>✦</div>
                <div style={{ fontSize: 13, textAlign: "center", lineHeight: 1.7 }}>Nada por acá.<br />Agregá algo abajo.</div>
              </div>
            : pending.map(item => <Card key={item.id} item={item} onComplete={completeItem} onEdit={setEditId} onDelete={deleteItem} onMoveCtx={moveCtx} onMoveType={moveType} onTap={setDetailItem} />)
          }
        </div>
      </>}

      {/* ── HOY ── */}
      {view === "hoy" && (
        <div style={feedStyle}>
          {overdue.length > 0 && <>{SECTION("⚠ Vencidas", "#c0392b")}{overdue.map(i => <Card key={i.id} item={i} onComplete={completeItem} onEdit={setEditId} onDelete={deleteItem} onMoveCtx={moveCtx} onMoveType={moveType} onTap={setDetailItem} />)}</>}
          {dueToday.length > 0 && <>{SECTION("📅 Vencen hoy", "#b8640a")}{dueToday.map(i => <Card key={i.id} item={i} onComplete={completeItem} onEdit={setEditId} onDelete={deleteItem} onMoveCtx={moveCtx} onMoveType={moveType} onTap={setDetailItem} />)}</>}
          {dueToday.length === 0 && overdue.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "50px 20px", color: "#a09890", gap: 8 }}>
              <div style={{ fontSize: 28 }}>⚡</div>
              <div style={{ fontSize: 13, textAlign: "center", lineHeight: 1.7 }}>Sin urgencias para hoy.<br /><span style={{ fontSize: 11 }}>Asignale fecha a una tarea para que aparezca acá.</span></div>
            </div>
          )}
          {todayDone.length > 0 && <>{SECTION(`✓ Completadas hoy (${todayDone.length})`, "#1a9460")}{todayDone.map(i => <HistCard key={i.id + "h"} item={i} />)}</>}
        </div>
      )}

      {/* ── HISTORIAL ── */}
      {view === "historial" && (
        <div style={feedStyle}>
          {streak > 0 && (
            <div style={{ background: "#fff8ec", border: "1.5px solid #f0c060", borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
              <span style={{ fontSize: 26 }}>🔥</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#a07000" }}>{streak} día{streak > 1 ? "s" : ""} en racha</div>
                <div style={{ fontSize: 11, color: "#c09040", marginTop: 2 }}>Completaste tareas {streak} día{streak > 1 ? "s" : ""} seguido{streak > 1 ? "s" : ""}</div>
              </div>
            </div>
          )}
          {histDays.length === 0
            ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", color: "#a09890", gap: 8 }}>
                <div style={{ fontSize: 28 }}>📜</div>
                <div style={{ fontSize: 13, textAlign: "center", lineHeight: 1.7 }}>Todavía no completaste ninguna tarea.</div>
              </div>
            : histDays.map(day => <HistoryDay key={day} day={day} items={histByDay[day]} />)
          }
        </div>
      )}

      <Compose onSend={addItem} />
      {detailItem && <DetailModal item={detailItem} onClose={() => setDetailItem(null)} onEdit={id => { setDetailItem(null); setEditId(id); }} onComplete={id => { completeItem(id); setDetailItem(null); }} onDelete={id => { deleteItem(id); setDetailItem(null); }} />}
      {editId && editItem_ && <EditModal item={editItem_} onSave={data => saveEdit(editId, data)} onClose={() => setEditId(null)} />}
    </div>
  );
}
