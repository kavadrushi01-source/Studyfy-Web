"use client";

import { LogoMark } from "@/components/ui/logo";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { colors, h1Style, labelStyle, mutedStyle, primaryBtn } from "@/lib/theme";
import { isFailure } from "../../lib/api";

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

  return (
    <div className="sf-auth-page" style={{ fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="sf-auth-header" style={{ padding: "16px 32px", maxWidth: 1120, margin: "0 auto", width: "100%" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
          <LogoMark />
          <span style={{ fontWeight: 700, fontSize: 18, color: colors.ink, letterSpacing: "-0.02em" }}>Studyfy</span>
        </Link>
      </header>
      <main className="sf-auth-main" style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 24px 64px" }}>
        <div className="sf-card sf-auth-card" style={{ padding: 32, width: 440, maxWidth: "100%" }}>
          <h1 style={{ ...h1Style, margin: "0 0 4px" }}>Forgot password?</h1>
          <p style={{ ...mutedStyle, margin: "0 0 20px" }}>
            Enter your account email — if it exists, a single-use reset link is on its way.
          </p>
          {sent ? (
            <div style={{ display: "grid", gap: 12 }}>
              <p style={{ color: colors.success, fontWeight: 600, margin: 0 }}>
                If that email exists, the reset link has been sent. Check your inbox (and spam).
              </p>
              <Link href="/login" style={{ ...primaryBtn, textAlign: "center", textDecoration: "none" }}>
                Back to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
              <label style={labelStyle}>
                School slug <span style={{ color: colors.muted, fontSize: 12 }}>(leave empty only for the platform owner)</span>
                <input className="sf-input" value={schoolSlug} onChange={(e) => setSchoolSlug(e.target.value)} placeholder="e.g. school-of-science" />
              </label>
              <label style={labelStyle}>
                Email
                <input className="sf-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              {error ? <p style={{ color: colors.danger, fontSize: 14, margin: 0 }}>{error}</p> : null}
              <button type="submit" disabled={loading} className="sf-btn sf-btn-primary">
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
