import { useState, useEffect } from "react";
import {
  fetchBlocks, createBlocks, updateBlock, deleteBlock, blockErrorMessage,
} from "./supabase";
import {
  BLOCK_TYPE, DAYS, hhmm, toMinutes, durationLabel,
  FIELD, LABEL, PRIMARY_BTN, GHOST_BTN, ERROR_BOX, Sheet, BlockTypePicker, DayPicker,
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
            <input type="time" value={start} onChange={e => setStart(e.target.value)} style={{ ...FIELD, fontFamily: "monospace" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={LABEL}>Hasta</div>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)} style={{ ...FIELD, fontFamily: "monospace" }} />
          </div>
        </div>

        <div>
          <div style={LABEL}>{isNew ? "Días (podés elegir varios)" : "Día"}</div>
          <DayPicker value={days} onToggle={toggleDay} />
        </div>

        {blockType === "ocio" ? (
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
            🎮 El ocio va con horario fijo: te aviso cuando empieza y cuando termina, así no se come el resto del día. No lleva tareas.
          </div>
        ) : (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={floating} onChange={e => setFloating(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16 }} />
          <span style={{ fontSize: 13, lineHeight: 1.45 }}>
            <b>Horario flexible</b>
            <span style={{ display: "block", color: "var(--ink-3)", fontSize: 12 }}>El horario es aproximado y puede pisarse con otros bloques. Ideal para el domingo.</span>
          </span>
        </label>
        )}

        {error && <div style={ERROR_BOX}>{error}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          {!isNew && <button onClick={remove} disabled={busy} style={{ ...GHOST_BTN, color: "var(--bad)", borderColor: "var(--bad-border)" }}>🗑</button>}
          <button onClick={onClose} style={{ ...GHOST_BTN, flex: 1 }}>Cancelar</button>
          <button onClick={save} disabled={busy} style={{ ...PRIMARY_BTN, flex: 2, opacity: busy ? 0.6 : 1 }}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
    </Sheet>
  );
}

// ─── FILA DE BLOQUE ──────────────────────────────────────────
function BlockRow({ block, onTap }) {
  const t = BLOCK_TYPE[block.block_type] || BLOCK_TYPE.otro;
  return (
    <button onClick={() => onTap(block)}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: t.bg, border: "none", borderLeft: `4px ${block.floating ? "dashed" : "solid"} ${t.color}`, borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontFamily: "inherit" }}>
      <span style={{ fontSize: 16 }}>{t.icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{block.label || t.label}</span>
        {block.floating && <span style={{ fontFamily: "monospace", fontSize: 9, color: "var(--ink-2)", fontWeight: 700, letterSpacing: "0.5px" }}>~ FLEXIBLE</span>}
      </span>
      <span style={{ fontFamily: "monospace", fontSize: 11.5, color: "var(--ink-2)", whiteSpace: "nowrap" }}>
        {block.floating ? "~" : ""}{hhmm(block.start_time)}–{hhmm(block.end_time)}
      </span>
    </button>
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
    <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px 40px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 2px" }}>
        <div style={{ fontSize: 13, color: "var(--ink-2)" }}>Tu semana tipo. Se repite todas las semanas.</div>
        {weekMinutes > 0 && <div style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--ink-3)" }}>{durationLabel(weekMinutes)}/sem</div>}
      </div>

      {error && <div style={ERROR_BOX}>{error}</div>}
      {loading && <div style={{ color: "var(--ink-3)", fontSize: 13, padding: 20, textAlign: "center" }}>Cargando…</div>}

      {!loading && DAYS.map(([n, name]) => {
        const list = byDay[n];
        const minutes = list.filter(b => !b.floating).reduce((s, b) => s + toMinutes(b.end_time) - toMinutes(b.start_time), 0);
        return (
          <div key={n} style={{ background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 15, padding: "11px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{name}</span>
              {minutes > 0 && <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--ink-3)" }}>{durationLabel(minutes)}</span>}
            </div>
            {list.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{n === 0 ? "Día libre. Podés sumar bloques flexibles." : "Sin bloques."}</div>}
            {list.map(b => <BlockRow key={b.id} block={b} onTap={block => setSheet({ block })} />)}
            <button onClick={() => setSheet({ day: n })}
              style={{ background: "transparent", border: "1.5px dashed var(--border)", borderRadius: 10, padding: "7px", fontFamily: "inherit", fontSize: 12, color: "var(--ink-2)", cursor: "pointer" }}>
              + Agregar bloque
            </button>
          </div>
        );
      })}


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
