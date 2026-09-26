import { useState, useEffect } from "react";
import { pushStatus, enablePush, disablePush, sendTestPush } from "./notifications";
import { GHOST_BTN, PRIMARY_BTN } from "./ui";

const TEXT = {
  install:     "En iPhone las notificaciones solo funcionan con la app instalada: en Safari, Compartir → \"Agregar a pantalla de inicio\", y abrila desde ese ícono.",
  unsupported: "Este navegador no soporta notificaciones push.",
  denied:      "Bloqueaste las notificaciones para esta app. Activalas desde los ajustes del navegador o del celu y volvé a entrar.",
  off:         "Te avisamos cuando empieza cada bloque, con sus tareas. Llegan aunque la app esté cerrada.",
  on:          "Activadas en este dispositivo. Te llega un aviso al empezar cada bloque (los de horario flexible no avisan).",
};

export default function PushSettings({ onChange }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState("");

  const refresh = () => pushStatus().then(s => { setStatus(s); onChange?.(s); }).catch(() => setStatus("unsupported"));
  useEffect(() => { refresh(); }, []);

  async function run(action, okMsg) {
    setBusy(true); setMsg("");
    try { await action(); if (okMsg) setMsg(okMsg); }
    catch (err) { setMsg(`Error: ${err.message}`); }
    finally { setBusy(false); refresh(); }
  }

  if (!status) return null;
  return (
    <div style={{ background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>🔔 Notificaciones</div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>{TEXT[status]}</div>
      {status === "off" && (
        <button onClick={() => run(enablePush, "Listo. Probá mandarte una de prueba.")} disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Activando…" : "Activar notificaciones"}
        </button>
      )}
      {status === "on" && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => run(sendTestPush, "Enviada. Tendría que llegarte en unos segundos.")} disabled={busy} style={{ ...GHOST_BTN, flex: 2 }}>Mandar una de prueba</button>
          <button onClick={() => run(disablePush)} disabled={busy} style={{ ...GHOST_BTN, flex: 1, color: "var(--ink-3)" }}>Desactivar</button>
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: msg.startsWith("Error") ? "var(--bad)" : "var(--good)" }}>{msg}</div>}
    </div>
  );
}
