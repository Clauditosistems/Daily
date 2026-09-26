// Constantes, helpers y estilos compartidos entre pantallas.

// Colores por tipo: variables de theme.css (cambian con el modo oscuro). bg = tinte suave sobre la superficie.
const typeColor = k => ({ color: `var(--t-${k})`, bg: `color-mix(in srgb, var(--t-${k}) 13%, var(--surface))` });

export const BLOCK_TYPE = {
  trabajo:  { label: "Trabajo",  icon: "💼", ...typeColor("trabajo") },
  estudio:  { label: "Estudio",  icon: "📚", ...typeColor("estudio") },
  facultad: { label: "Facultad", icon: "🎓", ...typeColor("facultad") },
  entreno:  { label: "Entreno",  icon: "🏋️", ...typeColor("entreno") },
  ocio:     { label: "Ocio",     icon: "🎮", ...typeColor("ocio") },
  otro:     { label: "Otro",     icon: "✦",  ...typeColor("otro") },
};

// Tipos que puede tener una tarea o rutina: el ocio es tiempo libre protegido, sin tareas.
export const TASK_TYPES = Object.keys(BLOCK_TYPE).filter(k => k !== "ocio");

export const PRIO = {
  high: { label: "Alta",  color: "var(--prio-high)" },
  mid:  { label: "Media", color: "var(--prio-mid)" },
  low:  { label: "Baja",  color: "var(--prio-low)" },
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
  background: "var(--surface-2)", border: "1.5px solid var(--border)", borderRadius: 10,
  color: "var(--ink)", fontFamily: "inherit", fontSize: 14, padding: "9px 12px", outline: "none", width: "100%", boxSizing: "border-box",
};
export const LABEL = { fontFamily: "monospace", fontSize: 9.5, color: "var(--ink-3)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 6 };
export const CHIP = (active, color = "var(--ink)", bg = "var(--ink)") => ({
  flexShrink: 0, padding: "6px 11px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit", fontSize: 12,
  border: `1.5px solid ${active ? color : "var(--border)"}`, background: active ? bg : "transparent",
  // El texto usa tinta, no el color del tipo (el color va en el borde y el fondo).
  color: active ? (bg === "var(--ink)" ? "var(--bg)" : "var(--ink)") : "var(--ink-2)", fontWeight: active ? 700 : 500,
});
export const PRIMARY_BTN = { background: "var(--ink)", color: "var(--bg)", border: "none", borderRadius: 12, padding: "12px 16px", fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" };
export const GHOST_BTN = { background: "transparent", color: "var(--ink)", border: "1.5px solid var(--border)", borderRadius: 12, padding: "11px 16px", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" };
export const ERROR_BOX = { background: "var(--bad-bg)", color: "var(--bad)", borderRadius: 10, padding: "9px 12px", fontSize: 12.5 };
export const SECTION = { fontFamily: "monospace", fontSize: 9.5, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", padding: "6px 2px 0" };

// ─── BOTTOM SHEET ────────────────────────────────────────────
export function Sheet({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: "22px 22px 0 0", padding: "20px 20px 34px", width: "100%", maxWidth: 520, boxShadow: "0 -8px 40px rgba(0,0,0,0.15)", maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16, boxSizing: "border-box" }}>
        <div style={{ width: 36, height: 4, background: "var(--border)", borderRadius: 2, margin: "0 auto" }} />
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
        <button key={k} onClick={() => onChange(k)} style={CHIP(value === k, p.color, "var(--surface)")}>● {p.label}</button>
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
