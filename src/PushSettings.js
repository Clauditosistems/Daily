import { useState, useEffect } from "react";
import { pushStatus, enablePush, disablePush, sendTestPush } from "./notifications";
import { PRIMARY_BTN, TEXT_BTN, Group, Row } from "./ui";

const TEXT = {
  install:     "En este navegador las notificaciones solo funcionan con la app instalada en la pantalla de inicio.",
  unsupported: "Este navegador no soporta notificaciones.",
  denied:      "Las notificaciones están bloqueadas para esta app. Activalas desde los ajustes del celu y volvé a entrar.",
  off:         "Te avisamos cuando empieza cada bloque, aunque la app esté cerrada.",
  on:          "Activadas en este dispositivo.",
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
    <Group header="Notificaciones" footer={msg || TEXT[status]}>
      {status === "off" && (
        <div style={{ padding: 12 }}>
          <button onClick={() => run(enablePush, "Listo. Probá mandarte una de prueba.")} disabled={busy}
            style={{ ...PRIMARY_BTN, width: "100%", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Activando…" : "Activar notificaciones"}
          </button>
        </div>
      )}
      {status === "on" && <>
        <Row onClick={busy ? undefined : () => run(sendTestPush, "Enviada. Tendría que llegarte en unos segundos.")}>
          <span style={{ ...TEXT_BTN, padding: 0 }}>Mandarme una de prueba</span>
        </Row>
        <Row divider onClick={busy ? undefined : () => run(disablePush)}>
          <span style={{ ...TEXT_BTN, padding: 0, color: "var(--ink-2)" }}>Desactivar en este dispositivo</span>
        </Row>
      </>}
      {(status === "install" || status === "unsupported" || status === "denied") && (
        <Row><span style={{ color: "var(--ink-2)", fontSize: 15 }}>No disponibles por ahora</span></Row>
      )}
    </Group>
  );
}
