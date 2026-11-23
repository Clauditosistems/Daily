import { useState, useEffect } from "react";
import { fetchBlocksForDay } from "./supabase";
import { BLOCK_TYPE, hhmm, toMinutes, addDays, PRIMARY_BTN, Icon } from "./ui";
import { placeTasks, blockDone, currentBlock, nextBlock, nowMinutes, durationText } from "./plan";
import { TaskRow } from "./TaskRow";
import DayClose from "./DayClose";

// "Ahora": solo el bloque en curso y sus tareas, para marcarlas rápido.
// Los bloques que ya pasaron no aparecen acá (el día completo está en "Día"); lo que quedó
// sin marcar vuelve en el cierre del día, que aparece cuando empieza el ocio.

const blockName = b => { const t = BLOCK_TYPE[b.block_type] || BLOCK_TYPE.otro; return `${t.icon} ${b.label || t.label}`; };

function Hero({ children }) {
  return (
    <div className="view-in" style={{ background: "var(--surface)", borderRadius: 20, boxShadow: "var(--shadow-card)",
      padding: "20px 20px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
      {children}
    </div>
  );
}

const Big = ({ children }) => (
  <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2, color: "var(--ink)", wordBreak: "break-word" }}>{children}</div>
);
const Soft = ({ children }) => <div style={{ fontSize: 16, color: "var(--ink-2)", lineHeight: 1.5 }}>{children}</div>;
const BIG_BTN = { ...PRIMARY_BTN, padding: "15px 18px", fontSize: 17, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 };

function BlockHeader({ block, nowMin }) {
  const start = toMinutes(block.start_time), end = toMinutes(block.end_time);
  const pct = Math.min(100, Math.max(0, Math.round(((nowMin - start) / (end - start)) * 100)));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--ink)" }}>{blockName(block)}</span>
        <span className="num" style={{ fontSize: 13, color: "var(--ink-2)", whiteSpace: "nowrap" }}>quedan {durationText(Math.max(0, end - nowMin))}</span>
      </div>
      <div className="num" style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
        {block.floating ? "~" : ""}{hhmm(block.start_time)} – {hhmm(block.end_time)}
      </div>
      <div style={{ height: 3, background: "var(--surface-2)", borderRadius: 2, marginTop: 12, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 2, transition: "width 0.6s var(--ease-sheet)" }} />
      </div>
    </div>
  );
}

function TaskList({ tasks, subs, onToggle, onToggleSub, onTap }) {
  return (
    <div>
      {tasks.map((t, i) => (
        <TaskRow key={t.id} task={t} subtasks={subs[t.id]} onToggle={onToggle} onToggleSub={onToggleSub} onTap={onTap} divider={i > 0} />
      ))}
    </div>
  );
}

export default function NowView({ blocks, tasks, subs = {}, checkins, dayOverride, today, loading, closeAt, nowIds = [],
  onToggle, onToggleSub, onTap, onCheckin, onClose }) {
  const [nowMin, setNowMin]     = useState(nowMinutes);
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
  const tomorrowLine = tomorrow
    ? `Mañana arrancás con ${blockName(tomorrow)} a las ${hhmm(tomorrow.start_time)}.`
    : "Mañana no tenés bloques.";
  const closing = !dayOverride && nowMin >= closeAt;
  const pending = tasks.filter(t => !t.done && !t.outcome && !nowIds.includes(t.id));
  const chosenNow = tasks.filter(t => nowIds.includes(t.id));

  let content;
  if (loading && !blocks.length) {
    content = <Soft>Cargando…</Soft>;
  } else if (dayOverride) {
    content = <Hero><Big>Hoy es un día atípico.</Big><Soft>Tomalo con calma. Los bloques de hoy quedan en pausa.</Soft></Hero>;
  } else {
    const cur = currentBlock(blocks, nowMin);
    const next = nextBlock(blocks.filter(b => !cur || b.block_id !== cur.block_id), nowMin);
    const nextLine = next && `Lo próximo: ${blockName(next)} a las ${hhmm(next.start_time)}.`;

    if (cur && cur.block_type !== "ocio") {
      const { inBlock } = placeTasks(blocks, tasks);
      const own = inBlock[cur.block_id] || [];
      const done = blockDone(cur, own, checkins);
      content = (
        <Hero>
          <BlockHeader block={cur} nowMin={nowMin} />
          {own.length > 0
            ? <TaskList tasks={own} subs={subs} onToggle={onToggle} onToggleSub={onToggleSub} onTap={onTap} />
            : <div><Big>No hay nada puntual.</Big><div style={{ marginTop: 6 }}><Soft>Con estar alcanza.</Soft></div></div>}
          {own.length > 0 && own.every(t => t.done) && <Soft>Listo el bloque.{nextLine ? ` ${nextLine}` : ""}</Soft>}
          {!done && <button onClick={() => onCheckin(cur, true)} style={own.length ? { ...BIG_BTN, background: "var(--surface-2)", color: "var(--good)" } : BIG_BTN}>Estuve</button>}
        </Hero>
      );
    } else if (cur || closing) {
      content = (
        <Hero>
          {cur && <BlockHeader block={cur} nowMin={nowMin} />}
          <Big>{cur ? `Tiempo libre hasta las ${hhmm(cur.end_time)}.` : "El día va cerrando."}</Big>
          <Soft>{cur ? "Está en el plan, disfrutalo." : tomorrowLine}{cur && nextLine ? ` ${nextLine}` : ""}</Soft>
          {chosenNow.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 2 }}>Elegiste hacer ahora</div>
              <TaskList tasks={chosenNow} subs={subs} onToggle={onToggle} onToggleSub={onToggleSub} onTap={onTap} />
            </div>
          )}
        </Hero>
      );
    } else if (next) {
      content = (
        <Hero>
          <Big>Ahora no tenés nada.</Big>
          <Soft>{nextLine} Empieza en {durationText(toMinutes(next.start_time) - nowMin)}.</Soft>
        </Hero>
      );
    } else if (blocks.length) {
      content = <Hero><Big>Por hoy está.</Big><Soft>{tomorrowLine}</Soft></Hero>;
    } else {
      content = <Hero><Big>Hoy no tenés bloques.</Big><Soft>{tomorrowLine}</Soft></Hero>;
    }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
      {content}
      {closing && <DayClose items={pending} subs={subs} doneToday={doneToday} onAction={onClose} />}
      {!closing && doneToday > 0 && (
        <div className="num" style={{ textAlign: "center", fontSize: 15, color: "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ color: "var(--good)", display: "flex" }}><Icon name="check" size={16} stroke={2.6} /></span>
          Hoy llevás {doneToday} hecha{doneToday === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
