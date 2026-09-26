// Lógica compartida entre la agenda y el modo Ahora.
import { PRIO_ORDER, toMinutes } from "./ui";

export const byPriority = (a, b) =>
  (a.done - b.done)
  || ((a.scheduled_time || "99") < (b.scheduled_time || "99") ? -1 : (a.scheduled_time || "99") > (b.scheduled_time || "99") ? 1 : 0)
  || (PRIO_ORDER[a.prio] - PRIO_ORDER[b.prio]) || a.created_at.localeCompare(b.created_at);

// Una tarea va al bloque que tiene asignado (aunque sea de otro tipo); si no, al primer bloque
// del día de su mismo tipo. El ocio nunca recibe tareas.
export function placeTasks(blocks, tasks) {
  const inBlock = Object.fromEntries(blocks.map(b => [b.block_id, []]));
  const loose = [];
  tasks.forEach(t => {
    if (t.block_id && inBlock[t.block_id]) return inBlock[t.block_id].push(t);
    const match = t.block_type && blocks.find(b => b.block_type === t.block_type && b.block_type !== "ocio");
    if (match) return inBlock[match.block_id].push(t);
    loose.push(t);
  });
  Object.values(inBlock).forEach(list => list.sort(byPriority));
  loose.sort(byPriority);
  return { inBlock, loose };
}

// Las rutinas que no se hicieron desaparecen al pasar el día: solo cuenta lo hecho.
export const visibleTasks = (tasks, today) =>
  tasks.filter(t => !(t.routine_id && !t.done && t.assigned_date < today));

// Un bloque está cumplido si hay alguna tarea suya hecha o se marcó "✓ Estuve".
export const blockDone = (block, blockTasks, checkins) =>
  (blockTasks || []).some(t => t.done) || checkins.includes(block.block_id);

export const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

export const blockStarted = (block, date, today, nowMin) =>
  date < today || (date === today && nowMin >= toMinutes(block.start_time));

// Bloque en curso: primero los de horario fijo; si no hay, uno flexible que contenga la hora.
export function currentBlock(blocks, nowMin) {
  const inside = b => nowMin >= toMinutes(b.start_time) && nowMin < toMinutes(b.end_time);
  return blocks.find(b => !b.floating && inside(b)) || blocks.find(b => b.floating && inside(b)) || null;
}

export const nextBlock = (blocks, nowMin) =>
  [...blocks].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time)).find(b => toMinutes(b.start_time) > nowMin) || null;

export function durationText(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${String(m).padStart(2, "0")}` : `${h}h`;
}
