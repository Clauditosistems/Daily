import { useState } from "react";
import { sendMagicLink } from "./supabase";
import { FIELD, PRIMARY_BTN, LARGE_TITLE } from "./ui";

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
    <div className="view-in" style={{ flex: 1, padding: "48px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={LARGE_TITLE}>Daily</div>
        <div style={{ fontSize: 16, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 10 }}>
          Tus bloques y tareas se guardan en la nube. Poné tu mail: te llega un link, lo tocás y entrás.
        </div>
      </div>
      {sent
        ? <div style={{ background: "var(--good-bg)", color: "var(--good)", borderRadius: 14, padding: "14px 16px", fontSize: 15, lineHeight: 1.5 }}>
            Te mandamos un link a <b>{email}</b>. Abrilo desde este mismo celu.
          </div>
        : <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@mail.com" aria-label="Tu mail" style={{ ...FIELD, background: "var(--surface)", boxShadow: "var(--shadow-card)", padding: "14px 16px" }} autoComplete="email" />
            <button type="submit" disabled={busy} style={{ ...PRIMARY_BTN, opacity: busy ? 0.6 : 1 }}>{busy ? "Enviando…" : "Mandarme el link"}</button>
          </form>}
      {error && <div style={{ color: "var(--bad)", fontSize: 14 }}>{error}</div>}
    </div>
  );
}
