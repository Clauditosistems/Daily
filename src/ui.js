// Constantes, helpers y estilos compartidos entre pantallas.
import { useEffect, useRef } from "react";

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
// Radios con jerarquía: 20 paneles y tarjeta protagonista · 14 tarjetas/listas · 10 campos y botones.
export const CARD = { background: "var(--surface)", borderRadius: 14, boxShadow: "var(--shadow-card)", flexShrink: 0 };
export const LARGE_TITLE = { fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, color: "var(--ink)" };
export const TITLE = { fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--ink)" };
export const META = { fontSize: 13, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" };

export const FIELD = {
  background: "var(--surface-2)", border: "none", borderRadius: 10,
  color: "var(--ink)", fontFamily: "inherit", fontSize: 16, padding: "11px 13px", outline: "none", width: "100%", boxSizing: "border-box",
};
export const LABEL = { fontSize: 13, color: "var(--ink-2)", fontWeight: 600, marginBottom: 8 };

// Pastilla. Sin color: acento del sistema. Con color de tipo: tinte suave + anillo; el texto siempre en tinta.
export const CHIP = (active, color, _bg) => {
  const tinted = !!color;
  return {
    flexShrink: 0, padding: "7px 13px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: 14, border: "none",
    fontWeight: active ? 600 : 500,
    background: active ? (tinted ? `color-mix(in srgb, ${color} 16%, var(--surface))` : "var(--accent)") : "var(--surface-2)",
    boxShadow: active && tinted ? `inset 0 0 0 1.5px ${color}` : "none",
    color: active && !tinted ? "#fff" : "var(--ink)",
    transition: "background 0.2s, box-shadow 0.2s",
  };
};
export const PRIMARY_BTN = { background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "14px 18px", fontFamily: "inherit", fontSize: 16, fontWeight: 600, cursor: "pointer" };
export const GHOST_BTN = { background: "var(--surface-2)", color: "var(--accent)", border: "none", borderRadius: 12, padding: "13px 18px", fontFamily: "inherit", fontSize: 16, fontWeight: 500, cursor: "pointer" };
export const TEXT_BTN = { background: "none", color: "var(--accent)", border: "none", padding: "8px 4px", fontFamily: "inherit", fontSize: 16, fontWeight: 500, cursor: "pointer" };
export const DANGER_BTN = { ...TEXT_BTN, color: "var(--bad)" };
export const ERROR_BOX = { background: "var(--bad-bg)", color: "var(--bad)", borderRadius: 10, padding: "10px 13px", fontSize: 14 };
export const SECTION = { fontSize: 13, fontWeight: 600, color: "var(--ink-2)", padding: "6px 4px 0" };

// ─── ÍCONOS (trazo fino, estilo SF Symbols) ──────────────────
const ICONS = {
  calendar: ["M7 3v4", "M17 3v4", "M3.5 10h17", "M6 5h12a2.5 2.5 0 0 1 2.5 2.5v11A2.5 2.5 0 0 1 18 21H6a2.5 2.5 0 0 1-2.5-2.5v-11A2.5 2.5 0 0 1 6 5z"],
  repeat: ["M17 2l4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "M7 22l-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3"],
  note: ["M8 3h8a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z", "M9 8h6", "M9 12h6", "M9 16h3.5"],
  chart: ["M6 20v-7", "M12 20V5", "M18 20v-10"],
  gear: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"],
  bell: ["M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9", "M13.73 21a2 2 0 0 1-3.46 0"],
  arrowUp: ["M12 19V5", "M5.5 11.5L12 5l6.5 6.5"],
  left: ["M15 18l-6-6 6-6"],
  right: ["M9 18l6-6-6-6"],
  check: ["M20 6L9 17l-5-5"],
  plus: ["M12 5v14", "M5 12h14"],
};

export function Icon({ name, size = 22, stroke = 1.8, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, display: "block", ...style }}>
      {ICONS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// ─── BOTÓN "ATRÁS" (Android) ─────────────────────────────────
// Cada panel o pantalla secundaria abierta agrega una entrada al historial; "atrás" cierra la de arriba
// en vez de salir de la app. Si se cierra desde la interfaz, se descarta su entrada sin afectar a las demás.
const backStack = [];
let ignorePops = 0;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (ignorePops > 0) { ignorePops--; return; }
    const top = backStack.pop();
    if (top) { top.byBack = true; top.close(); }
  });
}

export function useBackHandler(active, onBack) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    const entry = { close: () => ref.current(), byBack: false };
    backStack.push(entry);
    window.history.pushState({ daily: backStack.length }, "");
    return () => {
      const i = backStack.indexOf(entry);
      if (i >= 0) backStack.splice(i, 1);
      if (!entry.byBack) { ignorePops++; window.history.back(); }
    };
  }, [active]);
}

// ─── VIBRACIÓN ───────────────────────────────────────────────
// Un toque corto al completar algo (Android). Se puede apagar en Configuración; se guarda por dispositivo.
export function hapticsOn() {
  try { return localStorage.getItem("daily-haptics") !== "off"; } catch { return true; }
}
export function setHaptics(on) {
  try { localStorage.setItem("daily-haptics", on ? "on" : "off"); } catch {}
}
export function haptic(pattern = 12) {
  if (hapticsOn() && typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern);
}

// ─── INTERRUPTOR Y LISTAS AGRUPADAS ──────────────────────────
export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      style={{ width: 51, height: 31, borderRadius: 999, border: "none", padding: 2, cursor: disabled ? "default" : "pointer", flexShrink: 0,
        background: checked ? "var(--good-fill)" : "var(--surface-3)", transition: "background 0.25s", opacity: disabled ? 0.45 : 1 }}>
      <span style={{ display: "block", width: 27, height: 27, borderRadius: "50%", background: "#fff", boxShadow: "0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.16)",
        transform: `translateX(${checked ? 20 : 0}px)`, transition: "transform 0.3s var(--ease-spring)" }} />
    </button>
  );
}

// Grupo de filas estilo iOS: encabezado chico, una sola tarjeta, filas separadas por líneas finas.
export function Group({ header, footer, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, flexShrink: 0 }}>
      {header && <div style={{ ...SECTION, padding: "0 16px" }}>{header}</div>}
      <div style={{ ...CARD, overflow: "hidden" }}>{children}</div>
      {footer && <div style={{ fontSize: 13, color: "var(--ink-2)", padding: "0 16px", lineHeight: 1.45 }}>{footer}</div>}
    </div>
  );
}

export function Row({ children, onClick, divider, chevron, style }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 48, padding: "12px 16px", boxSizing: "border-box",
        background: "none", border: "none", textAlign: "left", fontFamily: "inherit", color: "var(--ink)", fontSize: 16,
        cursor: onClick ? "pointer" : "default", boxShadow: divider ? "inset 16px 0.5px 0 0 var(--surface), inset 0 0.5px 0 0 var(--border)" : "none", ...style }}>
      {children}
      {chevron && <span style={{ color: "var(--ink-3)", display: "flex" }}><Icon name="right" size={18} stroke={2} /></span>}
    </Tag>
  );
}

// Encabezado de pantalla: "‹ Volver" opcional arriba, título grande y una acción a la derecha.
export function ScreenTitle({ title, subtitle, back, backLabel = "Volver", right }) {
  return (
    <div style={{ padding: back ? "4px 16px 12px" : "14px 16px 12px", flexShrink: 0 }}>
      {back && (
        <button onClick={back} style={{ ...TEXT_BTN, display: "flex", alignItems: "center", gap: 2, padding: "8px 0 6px", marginLeft: -6, fontSize: 16 }}>
          <Icon name="left" size={20} stroke={2.2} /> {backLabel}
        </button>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={LARGE_TITLE}>{title}</div>
          {subtitle && <div style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 4 }}>{subtitle}</div>}
        </div>
        {right}
      </div>
    </div>
  );
}

// Control segmentado (Automático / Claro / Oscuro, secciones de Notas, etc.).
export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} style={{ display: "flex", background: "var(--surface-3)", borderRadius: 9, padding: 2 }}>
      {options.map(([k, text]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          style={{ flex: 1, padding: "6px 0", border: "none", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: "var(--ink)",
            fontWeight: value === k ? 600 : 500, transition: "background 0.25s var(--ease-sheet)",
            background: value === k ? "var(--surface)" : "transparent",
            boxShadow: value === k ? "0 3px 8px rgba(0,0,0,0.12), 0 3px 1px rgba(0,0,0,0.04)" : "none" }}>
          {text}
        </button>
      ))}
    </div>
  );
}

// ─── HOJA (bottom sheet) ─────────────────────────────────────
export function Sheet({ title, onClose, children }) {
  useBackHandler(true, onClose);
  return (
    <div className="overlay-in" style={{ position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div className="sheet-in" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: "20px 20px 0 0", padding: "10px 20px calc(28px + env(safe-area-inset-bottom))", width: "100%", maxWidth: 520,
          boxShadow: "var(--shadow-float)", maxHeight: "92vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 18, boxSizing: "border-box" }}>
        <div style={{ width: 36, height: 5, background: "var(--surface-3)", borderRadius: 3, margin: "0 auto 2px" }} />
        <div style={TITLE}>{title}</div>
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
        <button key={k} onClick={() => onChange(k)} style={CHIP(value === k)}>{p.label}</button>
      ))}
    </div>
  );
}

export function DayPicker({ value, onToggle }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {DAYS.map(([n, name, short]) => (
        <button key={n} onClick={() => onToggle(n)} title={name}
          style={{ ...CHIP(value.includes(n)), width: 40, height: 40, padding: 0, borderRadius: "50%" }}>{short}</button>
      ))}
    </div>
  );
}
