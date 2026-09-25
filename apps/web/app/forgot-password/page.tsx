"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { isFailure } from "../../lib/api";

const PRIMARY = "#2563EB";
const NAVY = "#0F172A";
const DANGER = "#DC2626";
const SUCCESS = "#059669";

// First half of password reset (§13.3): email (+ optional slug) → the API
// always answers success (enumeration-safe); the link travels by email.
export default function ForgotPasswordPage() {
  const [schoolSlug, setSchoolSlug] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${api}/api/v1/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          ...(schoolSlug.trim() ? { schoolSlug: schoolSlug.trim() } : {}),
        }),
      });
      const body = (await res.json()) as { data: { received: boolean } } | { error: { message: string } };
      if (isFailure(res, body)) {
        throw new Error(body.error?.message ?? "Request failed.");
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
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 32, width: 440, maxWidth: "100%" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 4px", color: NAVY }}>Forgot password?</h1>
          <p style={{ fontSize: 14, color: "#64748B", margin: "0 0 20px" }}>
            Enter your account email — if it exists, a single-use reset link is on its way.
          </p>
          {sent ? (
            <div style={{ display: "grid", gap: 12 }}>
              <p style={{ color: SUCCESS, fontWeight: 600, margin: 0 }}>
                If that email exists, the reset link has been sent. Check your inbox (and spam).
              </p>
              <Link href="/login" style={{ textAlign: "center", padding: 12, borderRadius: 10, background: PRIMARY, color: "#fff", fontWeight: 600, textDecoration: "none" }}>
                Back to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                School slug <span style={{ color: "#64748B", fontSize: 12 }}>(leave empty only for the platform owner)</span>
                <input value={schoolSlug} onChange={(e) => setSchoolSlug(e.target.value)} placeholder="e.g. school-of-science" style={input} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={input} />
              </label>
              {error ? <p style={{ color: DANGER, fontSize: 14, margin: 0 }}>{error}</p> : null}
              <button type="submit" disabled={loading} style={{ padding: 12, borderRadius: 10, border: 0, background: PRIMARY, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
