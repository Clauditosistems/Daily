import { useState, useEffect } from "react";
import {
  fetchBlocks, createBlocks, updateBlock, deleteBlock, blockErrorMessage,
} from "./supabase";
import {
  BLOCK_TYPE, DAYS, hhmm, toMinutes, durationLabel,
  FIELD, LABEL, PRIMARY_BTN, GHOST_BTN, ERROR_BOX, Sheet, BlockTypePicker, DayPicker, Group, Row, Icon, Toggle, DANGER_BTN, TEXT_BTN
} from "./ui";

// Un bloque que termina a medianoche se guarda como 24:00 (el input time no lo admite).
const endForDb = t => (t === "00:00" ? "24:00" : t);
const endForInput = t => (hhmm(t) === "24:00" ? "00:00" : hhmm(t));

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
      await onSave({ block_type: blockType, label: label.trim() || null, start_time: start, end_time: endDb, floating: blockType === "ocio" ? false : floating }, days);
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
    <Sheet title={isNew ? "Nuevo bloque" : "Editar bloque"} onClose={onClose}>

        <div>
          <div style={LABEL}>Tipo</div>
          <BlockTypePicker value={blockType} onChange={setBlockType} />
        </div>

        <div>
          <div style={LABEL}>Nombre (opcional)</div>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder={BLOCK_TYPE[blockType].label} style={FIELD} maxLength={60} />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={LABEL}>Desde</div>
            <input type="time" value={start} onChange={e => setStart(e.target.value)} style={{ ...FIELD, fontVariantNumeric: "tabular-nums" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={LABEL}>Hasta</div>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)} style={{ ...FIELD, fontVariantNumeric: "tabular-nums" }} />
          </div>
        </div>

        <div>
          <div style={LABEL}>{isNew ? "Días (podés elegir varios)" : "Día"}</div>
          <DayPicker value={days} onToggle={toggleDay} />
        </div>

        {blockType === "ocio" ? (
          <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
            El ocio va con horario fijo: te aviso cuando empieza y cuando termina, así no se come el resto del día. No lleva tareas.
          </div>
        ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1, fontSize: 16, lineHeight: 1.4 }}>
            Horario flexible
            <span style={{ display: "block", color: "var(--ink-2)", fontSize: 13, marginTop: 2 }}>Aproximado; puede pisarse con otros bloques y no avisa. Ideal para el domingo.</span>
          </span>
          <Toggle label="Horario flexible" checked={floating} onChange={setFloating} />
        </div>
        )}

        {error && <div style={ERROR_BOX}>{error}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          {!isNew && <button onClick={remove} disabled={busy} style={DANGER_BTN}>Eliminar</button>}
          <button onClick={onClose} style={{ ...TEXT_BTN, flex: 1, color: "var(--ink-2)" }}>Cancelar</button>
          <button onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, flex: 2, opacity: busy ? 0.6 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
    </Sheet>
  );
}

// ─── FILA DE BLOQUE ──────────────────────────────────────────
function BlockRow({ block, onTap, divider }) {
  const t = BLOCK_TYPE[block.block_type] || BLOCK_TYPE.otro;
  return (
    <Row onClick={() => onTap(block)} divider={divider} chevron>
      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: t.color, flexShrink: 0,
        boxShadow: block.floating ? `0 0 0 2px var(--surface), 0 0 0 3.5px ${t.color}` : "none", opacity: block.floating ? 0.6 : 1 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.icon} {block.label || t.label}</span>
        {block.floating && <span style={{ display: "block", fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>Horario flexible</span>}
      </span>
      <span className="num" style={{ fontSize: 15, color: "var(--ink-2)", whiteSpace: "nowrap" }}>
        {block.floating ? "~" : ""}{hhmm(block.start_time)}–{hhmm(block.end_time)}
      </span>
    </Row>
  );
}

// ─── VISTA PRINCIPAL ─────────────────────────────────────────
export default function BlocksView() {
  const [blocks, setBlocks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [sheet, setSheet]     = useState(null);  // { block } o { day }

  useEffect(() => {
    fetchBlocks().then(setBlocks).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);

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
    <div className="view-in" style={{ flex: 1, overflowY: "auto", padding: "4px 16px 40px", display: "flex", flexDirection: "column", gap: 24 }}>
      {error && <div style={ERROR_BOX}>{error}</div>}
      {loading && <div style={{ color: "var(--ink-2)", fontSize: 15, padding: 20, textAlign: "center" }}>Cargando…</div>}

      {!loading && DAYS.map(([n, name]) => {
        const list = byDay[n];
        const minutes = list.filter(b => !b.floating).reduce((s, b) => s + toMinutes(b.end_time) - toMinutes(b.start_time), 0);
        return (
          <Group key={n} header={minutes > 0 ? `${name} · ${durationLabel(minutes)}` : name}>
            {list.map((b, i) => <BlockRow key={b.id} block={b} divider={i > 0} onTap={block => setSheet({ block })} />)}
            <Row divider={list.length > 0} onClick={() => setSheet({ day: n })}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent)" }}>
                <Icon name="plus" size={18} stroke={2.2} /> {list.length === 0 && n === 0 ? "Agregar bloque (día libre)" : "Agregar bloque"}
              </span>
            </Row>
          </Group>
        );
      })}

      {weekMinutes > 0 && (
        <div className="num" style={{ fontSize: 13, color: "var(--ink-2)", textAlign: "center" }}>{durationLabel(weekMinutes)} de bloques por semana</div>
      )}

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
