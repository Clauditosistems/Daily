import { useState } from "react";
import { sendMagicLink } from "./supabase";
import { FIELD, PRIMARY_BTN } from "./ui";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent]   = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy]   = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setError("");
    try { await sendMagicLink(email.trim()); setSent(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ padding: "40px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 28 }}>🗓</div>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.5px" }}>Entrá a Daily</div>
      <div style={{ fontSize: 13, color: "#6b6457", lineHeight: 1.6 }}>
        Tus bloques y tareas se guardan en la nube. Poné tu mail: te llega un link, lo tocás y listo.
      </div>
      {sent
        ? <div style={{ background: "#edf8f3", border: "1.5px solid #1a9460", color: "#1a9460", borderRadius: 12, padding: "12px 14px", fontSize: 13, lineHeight: 1.5 }}>
            Te mandamos un link a <b>{email}</b>. Abrilo desde este mismo dispositivo.
          </div>
        : <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@mail.com" style={FIELD} autoComplete="email" />
            <button type="submit" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.6 : 1 }}>{busy ? "Enviando…" : "Mandarme el link"}</button>
          </form>}
      {error && <div style={{ color: "#c0392b", fontSize: 12 }}>{error}</div>}
    </div>
  );
}
