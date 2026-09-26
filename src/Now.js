import { useState, useEffect } from "react";
import { fetchBlocksForDay } from "./supabase";
import { BLOCK_TYPE, hhmm, toMinutes, addDays, PRIMARY_BTN, TEXT_BTN, Icon } from "./ui";
import { placeTasks, blockDone, currentBlock, nextBlock, nowMinutes, durationText } from "./plan";

// Una sola pregunta: ¿qué hago ahora? El bloque en curso y UNA tarea. Sin listas ni totales.
// Es la pantalla protagonista: la única con tipografía grande y más aire.

const blockName = b => { const t = BLOCK_TYPE[b.block_type] || BLOCK_TYPE.otro; return `${t.icon} ${b.label || t.label}`; };

function Hero({ children }) {
  return (
    <div className="view-in" style={{ background: "var(--surface)", borderRadius: 20, boxShadow: "var(--shadow-card)",
      padding: "22px 22px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      {children}
    </div>
  );
}

const Big = ({ children }) => (
  <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2, color: "var(--ink)", wordBreak: "break-word" }}>{children}</div>
);
const Soft = ({ children }) => <div style={{ fontSize: 16, color: "var(--ink-2)", lineHeight: 1.5 }}>{children}</div>;
const BIG_BTN = { ...PRIMARY_BTN, padding: "17px 18px", fontSize: 17, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 };

function BlockHeader({ block, nowMin }) {
  const start = toMinutes(block.start_time), end = toMinutes(block.end_time);
  const pct = Math.min(100, Math.max(0, Math.round(((nowMin - start) / (end - start)) * 100)));
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{blockName(block)}</span>
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
  const tomorrowLine = tomorrow
    ? `Mañana arrancás con ${blockName(tomorrow)} a las ${hhmm(tomorrow.start_time)}.`
    : "Mañana no tenés bloques.";

  let content;
  if (loading && !blocks.length) {
    content = <Soft>Cargando…</Soft>;
  } else if (dayOverride) {
    content = <Hero><Big>Hoy es un día atípico.</Big><Soft>Tomalo con calma. Los bloques de hoy quedan en pausa.</Soft></Hero>;
  } else {
    const cur = currentBlock(blocks, nowMin);
    const next = nextBlock(blocks.filter(b => !cur || b.block_id !== cur.block_id), nowMin);
    const nextLine = next && `Lo próximo: ${blockName(next)} a las ${hhmm(next.start_time)}.`;

    if (cur && cur.block_type === "ocio") {
      content = (
        <Hero>
          <BlockHeader block={cur} nowMin={nowMin} />
          <Big>Tiempo libre hasta las {hhmm(cur.end_time)}.</Big>
          <Soft>Está en el plan, disfrutalo.{nextLine ? ` ${nextLine}` : ""}</Soft>
        </Hero>
      );
    } else if (cur) {
      const { inBlock } = placeTasks(blocks, tasks);
      const own = inBlock[cur.block_id] || [];
      const pending = own.filter(x => !x.done);
      const candidates = pending.filter(x => !skipped.includes(x.id));
      const task = candidates[0] || pending[0];

      if (task) {
        content = (
          <Hero>
            <BlockHeader block={cur} nowMin={nowMin} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>Para ahora</div>
              <Big key={task.id}><span className="view-in" style={{ display: "block" }}>{task.text}</span></Big>
              {task.scheduled_time && <div className="num" style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 6 }}>a las {hhmm(task.scheduled_time)}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button onClick={async () => { await onToggle(task); setCheer(true); setTimeout(() => setCheer(false), 1600); }} style={BIG_BTN}>
                Listo
              </button>
              {pending.length > 1 && (
                <button onClick={() => setSkipped(s => (candidates.length <= 1 ? [] : [...s, task.id]))} style={{ ...TEXT_BTN, alignSelf: "center" }}>Otra cosa</button>
              )}
            </div>
          </Hero>
        );
      } else if (blockDone(cur, own, checkins)) {
        content = (
          <Hero>
            <BlockHeader block={cur} nowMin={nowMin} />
            <Big>Listo el bloque.</Big>
            <Soft>{nextLine || "Lo que queda del bloque es tuyo."}</Soft>
          </Hero>
        );
      } else {
        content = (
          <Hero>
            <BlockHeader block={cur} nowMin={nowMin} />
            <div>
              <Big>No hay nada puntual.</Big>
              <div style={{ marginTop: 8 }}><Soft>Con estar alcanza.</Soft></div>
            </div>
            <button onClick={() => onCheckin(cur, true)} style={BIG_BTN}>Estuve</button>
          </Hero>
        );
      }
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
      {cheer && (
        <div className="cheer-in" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--good)", fontSize: 16, fontWeight: 600 }}>
          <Icon name="check" size={18} stroke={2.6} /> Bien ahí
        </div>
      )}
      {!cheer && doneToday > 0 && (
        <div className="num" style={{ textAlign: "center", fontSize: 15, color: "var(--ink-2)" }}>
          Hoy llevás {doneToday} hecha{doneToday === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
