"use client";

import { LogoMark } from "@/components/ui/logo";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { colors, h1Style, labelStyle, mutedStyle } from "@/lib/theme";
import { isFailure } from "../../lib/api";

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

  return (
    <div className="sf-auth-page" style={{ fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="sf-auth-header" style={{ padding: "16px 32px", maxWidth: 1120, margin: "0 auto", width: "100%" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
          <LogoMark />
          <span style={{ fontWeight: 700, fontSize: 18, color: colors.ink, letterSpacing: "-0.02em" }}>Studyfy</span>
        </Link>
      </header>
      <main className="sf-auth-main" style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 24px 64px" }}>
        <div className="sf-card sf-auth-card" style={{ padding: 32, width: 520, maxWidth: "100%" }}>
          <h1 style={{ ...h1Style, margin: "0 0 4px" }}>Admission Enquiry</h1>
          <p style={{ ...mutedStyle, margin: "0 0 20px" }}>Write to a school — they reply on the phone or email you share.</p>
          {sent ? (
            <p style={{ color: colors.success, fontWeight: 600, margin: 0 }}>Received — the school will contact you shortly.</p>
          ) : (
            <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
              <label style={labelStyle}>
                School login slug
                <input className="sf-input" value={schoolSlug} onChange={(e) => setSchoolSlug(e.target.value)} required placeholder="e.g. school-of-science" />
              </label>
              <label style={labelStyle}>
                Your name
                <input className="sf-input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
              </label>
              <div className="sf-form-2col">
                <label style={labelStyle}>
                  Phone
                  <input className="sf-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Email
                  <input className="sf-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
              </div>
              <p style={{ fontSize: 12, color: colors.muted, margin: 0 }}>Share at least one contact above.</p>
              <label style={labelStyle}>
                Message
                <textarea className="sf-input" value={message} onChange={(e) => setMessage(e.target.value)} required minLength={10} rows={5} placeholder="Which class are you enquiring for, and what would you like to know?" style={{ resize: "vertical" }} />
              </label>
              {error ? <p style={{ color: colors.danger, fontSize: 14, margin: 0 }}>{error}</p> : null}
              <button type="submit" disabled={loading} className="sf-btn sf-btn-primary">
                {loading ? "Sending…" : "Send enquiry"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
