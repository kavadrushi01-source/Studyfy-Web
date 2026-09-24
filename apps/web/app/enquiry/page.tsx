"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { isFailure } from "../../lib/api";

const PRIMARY = "#2563EB";
const NAVY = "#0F172A";
const DANGER = "#DC2626";
const SUCCESS = "#059669";

// Admission enquiry page (§7 Phase 1 #10): writes to POST
// /api/v1/public/enquiries (rate-limited + honeypot server-side). Needs
// the school's login slug so the enquiry lands in the right tenant —
// schools share this slug on their own notices and website.
export default function EnquiryPage() {
  const [schoolSlug, setSchoolSlug] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${api}/api/v1/public/enquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolSlug: schoolSlug.trim(),
          name: name.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          message: message.trim(),
        }),
      });
      const body = (await res.json()) as { data: { received: boolean } } | { error: { message: string } };
      if (isFailure(res, body)) {
        throw new Error(body.error?.message ?? "Could not send your enquiry.");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  const input: React.CSSProperties = { padding: 10, borderRadius: 10, border: "1px solid #CBD5E1", fontSize: 14 };

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh", background: "#F8FAFC", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "16px 32px", maxWidth: 1120, margin: "0 auto", width: "100%" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <span style={{ width: 32, height: 32, borderRadius: 9, background: PRIMARY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18 }}>S</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: NAVY }}>Studyfy</span>
        </Link>
      </header>
      <main style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24 }}>
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 32, width: 520, maxWidth: "100%" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 4px", color: NAVY }}>Admission Enquiry</h1>
          <p style={{ fontSize: 14, color: "#64748B", margin: "0 0 20px" }}>Write to a school — they reply on the phone or email you share.</p>
          {sent ? (
            <p style={{ color: SUCCESS, fontWeight: 600, margin: 0 }}>Received — the school will contact you shortly.</p>
          ) : (
            <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                School login slug
                <input value={schoolSlug} onChange={(e) => setSchoolSlug(e.target.value)} required placeholder="e.g. school-of-science" style={input} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Your name
                <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} style={input} />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                  Phone
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} style={input} />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                  Email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
                </label>
              </div>
              <p style={{ fontSize: 12, color: "#64748B", margin: 0 }}>Share at least one contact above.</p>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Message
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} required minLength={10} rows={5} placeholder="Which class are you enquiring for, and what would you like to know?" style={{ ...input, resize: "vertical" }} />
              </label>
              {error ? <p style={{ color: DANGER, fontSize: 14, margin: 0 }}>{error}</p> : null}
              <button type="submit" disabled={loading} style={{ padding: 12, borderRadius: 10, border: 0, background: PRIMARY, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                {loading ? "Sending…" : "Send enquiry"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
