import { useState, useRef, useEffect, useCallback } from "react";
import { db } from "./db";
import { requestPermission, registerSW, scheduleDeadlineCheck, checkAndNotifyToday } from "./notifications";

// ─── CONSTANTES ──────────────────────────────────────────────
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
  mid:  { label: "Media", color: "#b8640a", ring: "rgba(184,100,10,0.22)" },
  low:  { label: "Baja",  color: "#1a9460", ring: "rgba(26,148,96,0.22)"  },
};
const TYPE_TAG = {
  task: { bg: "#f2f0ec", fg: "#3a3530" },
  note: { bg: "#f0f0ee", fg: "#5a5248" },
  idea: { bg: "#fdf4e3", fg: "#8a5800" },
  plan: { bg: "#edf2fc", fg: "#1e5fa8" },
};
const MAX_ATTACH_MB = 8; // límite por adjunto

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
    if (day === checkStr) {
      streak++;
      check.setDate(check.getDate() - 1);
    } else break;
  }
  return streak;
}

function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
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

// ─── ATTACHMENT PREVIEW ───────────────────────────────────────
function AttachPreview({ attachments }) {
  if (!attachments?.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 7 }}>
      {attachments.map((a, i) =>
        a.type?.startsWith("image/")
          ? <img key={i} src={a.data} alt={a.name}
              style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, border: "1px solid #d8d2c6", cursor: "pointer" }}
              onClick={() => window.open(a.data)} />
          : <a key={i} href={a.data} download={a.name}
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
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
      <button style={MENU_BTN()} onClick={() => { onComplete(); onClose(); }}>
        {item.done ? "🔄 Marcar pendiente" : "✅ Marcar completada"}
      </button>
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
function Card({ item, onComplete, onEdit, onDelete, onMoveCtx, onMoveType }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // BUG 1 FIX: debounce para evitar doble-click en completar
  const completing = useRef(false);
  const dl = deadlineInfo(item.deadline, item.time);
  const createdTime = new Date(item.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  function handleComplete() {
    if (completing.current) return;
    completing.current = true;
    onComplete(item.id);
    setTimeout(() => { completing.current = false; }, 800);
  }

  return (
    <div style={{ background: "#fff", border: "1.5px solid #d8d2c6", borderRadius: 15, padding: "11px 12px 10px 16px", position: "relative", opacity: item.done ? 0.44 : 1, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: "12%", bottom: "12%", width: 3, borderRadius: "0 2px 2px 0", background: CTX[item.ctx]?.accent || "#ccc" }} />

      {/* Tags */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 7, flexWrap: "wrap" }}>
        <span style={TAG_STYLE(CTX[item.ctx]?.bg, CTX[item.ctx]?.fg)}>{CTX[item.ctx]?.icon} {CTX[item.ctx]?.label}</span>
        <span style={TAG_STYLE(TYPE_TAG[item.type]?.bg, TYPE_TAG[item.type]?.fg)}>{TYPE[item.type]?.icon} {TYPE[item.type]?.label}</span>
        <div style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: PRIO[item.prio]?.color, boxShadow: `0 0 0 3px ${PRIO[item.prio]?.ring}` }} title={PRIO[item.prio]?.label} />
      </div>

      <AttachPreview attachments={item.attachments} />

      <div style={{ fontSize: 14, lineHeight: 1.5, color: item.done ? "#a09890" : "#1a1814", marginBottom: 8, wordBreak: "break-word", textDecoration: item.done ? "line-through" : "none" }}>
        {item.text}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {dl && (
          <span style={{ fontFamily: "monospace", fontSize: 9.5, fontWeight: 500, color: dl.overdue ? "#c0392b" : dl.isToday ? "#b8640a" : "#7a9ab0" }}>
            📅 {dl.label}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 9, color: "#b0a898" }}>{createdTime}</span>
        {!item.done && (
          <button onClick={handleComplete} title="Completar"
            style={{ background: "#edf8f3", border: "1.5px solid #1a9460", color: "#1a9460", borderRadius: 8, width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontWeight: 700 }}>
            ✓
          </button>
        )}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button onClick={() => setMenuOpen(v => !v)}
            style={{ background: "#ede9e1", border: "1px solid #d8d2c6", color: "#6b6457", borderRadius: 8, width: 28, height: 28, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
            ⋯
          </button>
          {menuOpen && (
            <CardMenu item={item}
              onEdit={() => onEdit(item.id)}
              onComplete={handleComplete}
              onDelete={() => onDelete(item.id)}
              onMoveCtx={k => onMoveCtx(item.id, k)}
              onMoveType={k => onMoveType(item.id, k)}
              onClose={() => setMenuOpen(false)} />
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
      <AttachPreview attachments={item.attachments} />
      <div style={{ fontSize: 13, color: "#5a5248", textDecoration: "line-through", lineHeight: 1.45, marginBottom: dl ? 4 : 0 }}>{item.text}</div>
      {dl && <span style={{ fontFamily: "monospace", fontSize: 9, color: "#a09890" }}>📅 {dl.label}</span>}
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
      // BUG 3 FIX: límite de tamaño por adjunto
      if (f.size > MAX_ATTACH_MB * 1024 * 1024) {
        setAttachError(`"${f.name}" supera el límite de ${MAX_ATTACH_MB}MB`);
        continue;
      }
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
          style={{ background: showDate ? "#1a1814" : "#ede9e1", color: showDate ? "#f5f2ec" : "#6b6457", border: `1.5px solid ${showDate ? "#1a1814" : "#d8d2c6"}`, borderRadius: 10, padding: "0 10px", height: 38, fontFamily: "inherit", fontSize: 14, cursor: "pointer", flexShrink: 0 }}>
          📅
        </button>
        <button onClick={() => fileRef.current?.click()}
          style={{ background: "#ede9e1", border: "1.5px solid #d8d2c6", color: "#6b6457", borderRadius: 10, padding: "0 10px", height: 38, fontFamily: "inherit", fontSize: 14, cursor: "pointer", flexShrink: 0 }}>
          📎
        </button>
        <input ref={fileRef} type="file" multiple onChange={handleFiles} style={{ display: "none" }} />
        <div style={{ flex: 1, background: "#ede9e1", border: "1.5px solid #d8d2c6", borderRadius: 13, padding: "7px 12px", display: "flex", alignItems: "flex-end" }}>
          <textarea ref={textRef} value={text}
            onChange={e => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Escribí y Enter…" rows={1}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#1a1814", fontFamily: "inherit", fontSize: 14, resize: "none", minHeight: 24, maxHeight: 90, lineHeight: 1.4, padding: 0, width: "100%" }} />
        </div>
        <button onClick={send}
          style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: "#1a1814", color: "#f5f2ec", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          ↑
        </button>
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
  const [editId,   setEditId]  = useState(null);
  const [loading,  setLoading] = useState(true);
  const [notifOk,  setNotifOk] = useState(false);

  // ── CARGAR DESDE INDEXEDDB ───────────────────────────────
  useEffect(() => {
    registerSW();
    async function load() {
      try {
        const [its, hist] = await Promise.all([db.getItems(), db.getHistory()]);
        its.sort((a, b) => new Date(b.ts) - new Date(a.ts));
        hist.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
        setItems(its);
        setHistory(hist);
        if (Notification.permission === "granted") setNotifOk(true);
      } catch (e) {
        console.error("Error cargando DB:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── NOTIFICACIONES ───────────────────────────────────────
  async function handleNotifRequest() {
    const ok = await requestPermission();
    setNotifOk(ok);
    if (ok) checkAndNotifyToday(items);
  }

  // ── AGREGAR TAREA ────────────────────────────────────────
  async function addItem(data) {
    const item = { id: Date.now(), ...data, done: false, ts: new Date().toISOString() };
    await db.saveItem(item);
    setItems(p => [item, ...p]);
    scheduleDeadlineCheck([item, ...items]);
  }

  // ── COMPLETAR / REVERTIR — BUG 1 CORREGIDO ──────────────
  async function completeItem(id) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    if (item.done) {
      // Revertir: quitar de historial, marcar pendiente
      const updated = { ...item, done: false, completedAt: undefined, completedDate: undefined };
      await Promise.all([db.saveItem(updated), db.removeHistory(id)]);
      setItems(p => p.map(i => i.id === id ? updated : i));
      setHistory(p => p.filter(i => i.id !== id));
    } else {
      // BUG 1 FIX: verificar que no esté ya en historial antes de agregar
      const alreadyDone = history.some(i => i.id === id);
      if (alreadyDone) return;
      const completedAt   = new Date().toISOString();
      const completedDate = todayStr();
      const updated  = { ...item, done: true, completedAt, completedDate };
      const histItem = { ...item, done: true, completedAt, completedDate };
      await Promise.all([db.saveItem(updated), db.saveHistory(histItem)]);
      setItems(p => p.map(i => i.id === id ? updated : i));
      setHistory(p => [histItem, ...p]);
    }
  }

  // ── EDITAR — BUG 2 CORREGIDO ────────────────────────────
  async function saveEdit(id, data) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, ...data };
    await db.saveItem(updated);
    setItems(p => p.map(i => i.id === id ? updated : i));
    // BUG 2 FIX: si la tarea está en el historial, actualizarlo también
    if (updated.done) {
      const histItem = history.find(h => h.id === id);
      if (histItem) {
        const updatedHist = { ...histItem, ...data };
        await db.saveHistory(updatedHist);
        setHistory(p => p.map(i => i.id === id ? updatedHist : i));
      }
    }
    setEditId(null);
  }

  async function deleteItem(id) {
    await Promise.all([db.removeItem(id), db.removeHistory(id)]);
    setItems(p => p.filter(i => i.id !== id));
    setHistory(p => p.filter(i => i.id !== id));
  }

  async function moveCtx(id, ctx) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, ctx };
    await db.saveItem(updated);
    setItems(p => p.map(i => i.id === id ? updated : i));
  }

  async function moveType(id, type) {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const updated = { ...item, type };
    await db.saveItem(updated);
    setItems(p => p.map(i => i.id === id ? updated : i));
  }

  // ── DERIVADOS ────────────────────────────────────────────
  const streak   = calcStreak(history);
  const today    = todayStr();
  const counts   = { all: 0, ...Object.fromEntries(Object.keys(CTX).map(k => [k, 0])) };
  items.filter(i => !i.done).forEach(i => { counts.all++; if (counts[i.ctx] !== undefined) counts[i.ctx]++; });
  const pending  = items.filter(i => !i.done && (filter === "all" || i.ctx === filter));
  const dueToday = items.filter(i => !i.done && i.deadline === today);
  const overdue  = items.filter(i => !i.done && i.deadline && i.deadline < today);
  const todayDone = history.filter(i => i.completedDate === today);
  const histByDay = {};
  history.forEach(i => { if (!histByDay[i.completedDate]) histByDay[i.completedDate] = []; histByDay[i.completedDate].push(i); });
  const histDays = Object.keys(histByDay).sort().reverse();
  const editItem_ = items.find(i => i.id === editId);

  const feedStyle = { flex: 1, overflowY: "auto", padding: "10px 14px 230px", display: "flex", flexDirection: "column", gap: 8 };

  const SECTION = (label, color) => (
    <div style={{ fontFamily: "monospace", fontSize: 9.5, color, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", padding: "6px 0 3px" }}>{label}</div>
  );

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh", background: "#f5f2ec", color: "#a09890", fontSize: 13 }}>
      Cargando…
    </div>
  );

  return (
    <div style={{ fontFamily: "'Segoe UI',system-ui,sans-serif", background: "#f5f2ec", height: "100dvh", display: "flex", flexDirection: "column", maxWidth: 520, margin: "0 auto", position: "relative", fontSize: 14 }}>

      {/* HEADER */}
      <div style={{ background: "#f5f2ec", padding: "14px 16px 0", position: "sticky", top: 0, zIndex: 30, borderBottom: "1px solid #d8d2c6" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.7px" }}>Daily</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {streak > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#fff8ec", border: "1.5px solid #f0c060", borderRadius: 20, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, color: "#a07000" }}>
                🔥 {streak}d
              </div>
            )}
            {!notifOk && (
              <button onClick={handleNotifRequest}
                style={{ background: "#eef3fd", border: "1.5px solid #2563c4", color: "#2563c4", borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                🔔 Activar alertas
              </button>
            )}
            <span style={{ fontFamily: "monospace", fontSize: 9, color: "#a09890" }}>
              {new Date().toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
            </span>
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
        <div style={{ padding: "10px 14px 2px", display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none" }}>
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
        <div style={feedStyle}>
          {pending.length === 0
            ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", color: "#a09890", gap: 8 }}>
                <div style={{ fontSize: 28 }}>✦</div>
                <div style={{ fontSize: 13, textAlign: "center", lineHeight: 1.7 }}>Todo al día.<br />Agregá algo abajo.</div>
              </div>
            : pending.map(item => <Card key={item.id} item={item} onComplete={completeItem} onEdit={setEditId} onDelete={deleteItem} onMoveCtx={moveCtx} onMoveType={moveType} />)
          }
        </div>
      </>}

      {/* ── HOY ── */}
      {view === "hoy" && (
        <div style={feedStyle}>
          {overdue.length > 0 && <>{SECTION("⚠ Vencidas", "#c0392b")}{overdue.map(i => <Card key={i.id} item={i} onComplete={completeItem} onEdit={setEditId} onDelete={deleteItem} onMoveCtx={moveCtx} onMoveType={moveType} />)}</>}
          {dueToday.length > 0 && <>{SECTION("📅 Vencen hoy", "#b8640a")}{dueToday.map(i => <Card key={i.id} item={i} onComplete={completeItem} onEdit={setEditId} onDelete={deleteItem} onMoveCtx={moveCtx} onMoveType={moveType} />)}</>}
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
            : histDays.map(day => (
                <div key={day}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "monospace", fontSize: 9.5, color: "#a09890", letterSpacing: "1px", textTransform: "uppercase", margin: "8px 0 5px" }}>
                    <div style={{ flex: 1, height: 1, background: "#d8d2c6" }} />
                    <span style={{ background: "#f5f2ec", padding: "0 6px", whiteSpace: "nowrap" }}>
                      {dayLabel(day)} · {histByDay[day].length} tarea{histByDay[day].length > 1 ? "s" : ""}
                    </span>
                    <div style={{ flex: 1, height: 1, background: "#d8d2c6" }} />
                  </div>
                  {histByDay[day].map(i => <HistCard key={i.id + day} item={i} />)}
                </div>
              ))
          }
        </div>
      )}

      <Compose onSend={addItem} />
      {editId && editItem_ && <EditModal item={editItem_} onSave={data => saveEdit(editId, data)} onClose={() => setEditId(null)} />}
    </div>
  );
}
