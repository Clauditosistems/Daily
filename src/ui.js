// Constantes, helpers y estilos compartidos entre pantallas.

export const BLOCK_TYPE = {
  trabajo:  { label: "Trabajo",  icon: "💼", color: "#c0392b", bg: "#fdf1ee" },
  estudio:  { label: "Estudio",  icon: "📚", color: "#2563c4", bg: "#eef3fd" },
  facultad: { label: "Facultad", icon: "🎓", color: "#7c3aad", bg: "#f5eeff" },
  entreno:  { label: "Entreno",  icon: "🏋️", color: "#1a9460", bg: "#edf8f3" },
  ocio:     { label: "Ocio",     icon: "🎮", color: "#b8640a", bg: "#fdf6e8" },
  otro:     { label: "Otro",     icon: "✦",  color: "#5a5248", bg: "#f2f0ec" },
};

export const PRIO = {
  high: { label: "Alta",  color: "#c0392b" },
  mid:  { label: "Media", color: "#e6b800" },
  low:  { label: "Baja",  color: "#1a9460" },
};
export const PRIO_ORDER = { high: 0, mid: 1, low: 2 };

// day_of_week sigue Date.getDay() (0=domingo); la semana se muestra de lunes a domingo.
export const DAYS = [
  [1, "Lunes", "L"], [2, "Martes", "M"], [3, "Miércoles", "X"], [4, "Jueves", "J"],
  [5, "Viernes", "V"], [6, "Sábado", "S"], [0, "Domingo", "D"],
];

// ─── HORAS ───────────────────────────────────────────────────
// Postgres devuelve "09:00:00"; un bloque que termina a medianoche se guarda como 24:00.
export const hhmm = t => (t || "").slice(0, 5);
export const toMinutes = t => { const [h, m] = hhmm(t).split(":").map(Number); return h * 60 + m; };

export function durationLabel(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

// ─── FECHAS (siempre locales, formato YYYY-MM-DD) ────────────
export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export const todayStr = () => ymd(new Date());
export function addDays(s, n) {
  const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d);
}
export function weekDates(s) {
  const d = parseYmd(s);
  const monday = addDays(s, -((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
// Fecha (YYYY-MM-DD) de un cumpleaños en un año dado; el 29/2 cae el 28/2 si el año no es bisiesto.
export function birthdayOn(month, day, year) {
  const last = new Date(year, month, 0).getDate();
  return ymd(new Date(year, month - 1, Math.min(day, last)));
}

export function dayTitle(s) {
  const today = todayStr();
  if (s === today) return "Hoy";
  if (s === addDays(today, 1)) return "Mañana";
  if (s === addDays(today, -1)) return "Ayer";
  const label = parseYmd(s).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ─── ESTILOS ─────────────────────────────────────────────────
export const FIELD = {
  background: "#ede9e1", border: "1.5px solid #d8d2c6", borderRadius: 10,
  color: "#1a1814", fontFamily: "inherit", fontSize: 14, padding: "9px 12px", outline: "none", width: "100%", boxSizing: "border-box",
};
export const LABEL = { fontFamily: "monospace", fontSize: 9.5, color: "#a09890", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6 };
export const CHIP = (active, color = "#1a1814", bg = "#1a1814") => ({
  flexShrink: 0, padding: "6px 11px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit", fontSize: 12,
  border: `1.5px solid ${active ? color : "#d8d2c6"}`, background: active ? bg : "transparent",
  color: active ? (bg === "#1a1814" ? "#f5f2ec" : color) : "#6b6457", fontWeight: active ? 700 : 500,
});
export const PRIMARY_BTN = { background: "#1a1814", color: "#f5f2ec", border: "none", borderRadius: 12, padding: "12px 16px", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" };
export const GHOST_BTN = { background: "transparent", color: "#1a1814", border: "1.5px solid #d8d2c6", borderRadius: 12, padding: "11px 16px", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" };
export const ERROR_BOX = { background: "#fdf1ee", color: "#c0392b", borderRadius: 10, padding: "9px 12px", fontSize: 12.5 };
export const SECTION = { fontFamily: "monospace", fontSize: 9.5, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", padding: "6px 2px 0" };

// ─── BOTTOM SHEET ────────────────────────────────────────────
export function Sheet({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: "22px 22px 0 0", padding: "20px 20px 34px", width: "100%", maxWidth: 520, boxShadow: "0 -8px 40px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, boxSizing: "border-box" }}>
        <div style={{ width: 36, height: 4, background: "#d8d2c6", borderRadius: 2, margin: "0 auto" }} />
        <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

// Selector de tipo de bloque; con allowNone agrega "Sin bloque".
export function BlockTypePicker({ value, onChange, allowNone = false, types = Object.keys(BLOCK_TYPE) }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {allowNone && <button onClick={() => onChange(null)} style={CHIP(value === null)}>Sin bloque</button>}
      {types.map(k => {
        const t = BLOCK_TYPE[k];
        return <button key={k} onClick={() => onChange(k)} style={CHIP(value === k, t.color, t.bg)}>{t.icon} {t.label}</button>;
      })}
    </div>
  );
}

export function PrioPicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {Object.entries(PRIO).map(([k, p]) => (
        <button key={k} onClick={() => onChange(k)} style={CHIP(value === k, p.color, "#fff")}>● {p.label}</button>
      ))}
    </div>
  );
}

export function DayPicker({ value, onToggle }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {DAYS.map(([n, name, short]) => (
        <button key={n} onClick={() => onToggle(n)} title={name}
          style={{ ...CHIP(value.includes(n)), width: 38, height: 38, padding: 0, borderRadius: "50%" }}>{short}</button>
      ))}
    </div>
  );
}
