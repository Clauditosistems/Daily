import { useState, useEffect } from "react";
import { fetchBlocksForDay } from "./supabase";
import { BLOCK_TYPE, hhmm, toMinutes, addDays, PRIMARY_BTN, GHOST_BTN } from "./ui";
import { placeTasks, blockDone, currentBlock, nextBlock, nowMinutes, durationText } from "./plan";

// Una sola pregunta: ¿qué hago ahora? El bloque en curso y UNA tarea. Sin listas ni totales.

const blockName = b => { const t = BLOCK_TYPE[b.block_type] || BLOCK_TYPE.otro; return `${t.icon} ${b.label || t.label}`; };

function Card({ children, accent }) {
  return (
    <div style={{ background: "var(--surface)", border: "1.5px solid var(--border)", borderLeft: accent ? `5px solid ${accent}` : undefined,
      borderRadius: 18, padding: "18px 18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      {children}
    </div>
  );
}

const Big = ({ children }) => <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.35, color: "var(--ink)", wordBreak: "break-word" }}>{children}</div>;
const Soft = ({ children }) => <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.55 }}>{children}</div>;

export default function NowView({ blocks, tasks, checkins, dayOverride, today, loading, onToggle, onCheckin }) {
  const [nowMin, setNowMin]     = useState(nowMinutes);
  const [skipped, setSkipped]   = useState([]);
  const [cheer, setCheer]       = useState(false);
  const [tomorrow, setTomorrow] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setNowMin(nowMinutes()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetchBlocksForDay(addDays(today, 1))
      .then(b => setTomorrow([...b].filter(x => x.block_type !== "ocio").sort((a, c) => toMinutes(a.start_time) - toMinutes(c.start_time))[0] || null))
      .catch(() => {});
  }, [today]);

  const doneToday = tasks.filter(t => t.done).length;
  const footer = doneToday > 0 && (
    <div style={{ textAlign: "center", fontSize: 13, color: "var(--good)", fontWeight: 600 }}>Hoy: {doneToday} hecha{doneToday === 1 ? "" : "s"} ✓</div>
  );
  const tomorrowLine = tomorrow
    ? `Mañana arrancás con ${blockName(tomorrow)} a las ${hhmm(tomorrow.start_time)}.`
    : "Mañana no tenés bloques.";

  let content;
  if (loading && !blocks.length) {
    content = <Soft>Cargando…</Soft>;
  } else if (dayOverride) {
    content = <Card><Big>☾ Hoy es un día atípico.</Big><Soft>Tomalo con calma. Los bloques de hoy quedan en pausa.</Soft></Card>;
  } else {
    const cur = currentBlock(blocks, nowMin);
    const next = nextBlock(blocks.filter(b => !cur || b.block_id !== cur.block_id), nowMin);
    const nextLine = next && `Lo próximo: ${blockName(next)} a las ${hhmm(next.start_time)}.`;

    if (cur) {
      const t = BLOCK_TYPE[cur.block_type] || BLOCK_TYPE.otro;
      const start = toMinutes(cur.start_time), end = toMinutes(cur.end_time);
      const left = Math.max(0, end - nowMin);
      const pct = Math.min(100, Math.round(((nowMin - start) / (end - start)) * 100));
      const header = (
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{blockName(cur)}</div>
          <div style={{ fontFamily: "monospace", fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
            {cur.floating ? "~" : ""}{hhmm(cur.start_time)} – {hhmm(cur.end_time)} · quedan {durationText(left)}
          </div>
          <div style={{ height: 4, background: "var(--surface-2)", borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: t.color, borderRadius: 4 }} />
          </div>
        </div>
      );

      if (cur.block_type === "ocio") {
        content = (
          <Card accent={t.color}>
            {header}
            <Big>Tiempo libre hasta las {hhmm(cur.end_time)}.</Big>
            <Soft>Está en el plan, disfrutalo.{nextLine ? ` ${nextLine}` : ""}</Soft>
          </Card>
        );
      } else {
        const { inBlock } = placeTasks(blocks, tasks);
        const own = inBlock[cur.block_id] || [];
        const pending = own.filter(x => !x.done);
        const candidates = pending.filter(x => !skipped.includes(x.id));
        const task = candidates[0] || pending[0];
        const cumplido = blockDone(cur, own, checkins);

        if (task) {
          content = (
            <Card accent={t.color}>
              {header}
              <div>
                <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: "1px", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6 }}>Para ahora</div>
                <Big>{task.scheduled_time && <span style={{ fontFamily: "monospace", fontSize: 16, marginRight: 8 }}>{hhmm(task.scheduled_time)}</span>}{task.text}</Big>
              </div>
              {cheer && <div style={{ color: "var(--good)", fontWeight: 700, fontSize: 14 }}>Bien ahí ✓</div>}
              <button onClick={async () => { await onToggle(task); setCheer(true); setTimeout(() => setCheer(false), 1600); }}
                style={{ ...PRIMARY_BTN, padding: "15px 16px", fontSize: 16 }}>✓ Listo</button>
              {pending.length > 1 && (
                <button onClick={() => setSkipped(s => (candidates.length <= 1 ? [] : [...s, task.id]))} style={GHOST_BTN}>Otra cosa</button>
              )}
            </Card>
          );
        } else if (cumplido) {
          content = (
            <Card accent={t.color}>
              {header}
              <Big>Listo el bloque ✓</Big>
              <Soft>{nextLine || "Lo que queda del bloque es tuyo."}</Soft>
            </Card>
          );
        } else {
          content = (
            <Card accent={t.color}>
              {header}
              <Big>No hay nada puntual.</Big>
              <Soft>Con estar alcanza.</Soft>
              <button onClick={() => onCheckin(cur, true)} style={{ ...PRIMARY_BTN, padding: "15px 16px", fontSize: 16 }}>✓ Estuve</button>
            </Card>
          );
        }
      }
    } else if (next) {
      content = (
        <Card>
          <Big>Ahora no tenés nada.</Big>
          <Soft>{nextLine} (en {durationText(toMinutes(next.start_time) - nowMin)})</Soft>
        </Card>
      );
    } else if (blocks.length) {
      content = <Card><Big>Por hoy está. 🌙</Big><Soft>{tomorrowLine}</Soft></Card>;
    } else {
      content = <Card><Big>Hoy no tenés bloques.</Big><Soft>{tomorrowLine}</Soft></Card>;
    }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px 30px", display: "flex", flexDirection: "column", gap: 14 }}>
      {content}
      {footer}
    </div>
  );
}
