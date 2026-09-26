"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { colors, gradients, h1Style, labelStyle, mutedStyle, primaryBtn } from "@/lib/theme";
import { isFailure } from "../../lib/api";

// Password reset (§13.3): token arrives by email as ?token=. Single-use,
// 1-hour links — used, expired, and garbage tokens all fail identically.
export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${api}/api/v1/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), newPassword: password }),
      });
      const body = (await res.json()) as { data: { reset: boolean } } | { error: { message: string } };
      if (isFailure(res, body)) {
        throw new Error(body.error?.message ?? "Reset failed.");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  const logoTile: React.CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 10,
    background: gradients.accent,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: 18,
    letterSpacing: "-0.02em",
    boxShadow: "0 6px 18px -6px rgba(37,99,235,.7), inset 0 1px 0 rgba(255,255,255,.25)",
  };

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh", background: "transparent", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "16px 32px", maxWidth: 1120, margin: "0 auto", width: "100%" }}>
        <Link href="/" style={{ display: "inline-flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
          <span style={logoTile}>S</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: colors.ink, letterSpacing: "-0.02em" }}>Studyfy</span>
        </Link>
      </header>
      <main style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 24px 64px" }}>
        <div className="sf-card" style={{ padding: 32, width: 440, maxWidth: "100%" }}>
          <h1 style={{ ...h1Style, margin: "0 0 4px" }}>Set a new password</h1>
          <p style={{ ...mutedStyle, margin: "0 0 20px" }}>Paste the token from your reset email.</p>
          {done ? (
            <div style={{ display: "grid", gap: 12 }}>
              <p style={{ color: colors.success, fontWeight: 600, margin: 0 }}>Password updated — all other sessions were signed out.</p>
              <Link href="/login" style={{ ...primaryBtn, textAlign: "center", textDecoration: "none" }}>
                Back to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
              <label style={labelStyle}>
                Reset token
                <input className="sf-input" value={token} onChange={(e) => setToken(e.target.value)} required minLength={16} style={{ fontFamily: "monospace", fontSize: 12 }} />
              </label>
              <label style={labelStyle}>
                New password <span style={{ color: colors.muted, fontSize: 12 }}>(min 8 characters)</span>
                <input className="sf-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </label>
              <label style={labelStyle}>
                Confirm new password
                <input className="sf-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
              </label>
              {error ? <p style={{ color: colors.danger, fontSize: 14, margin: 0 }}>{error}</p> : null}
              <button type="submit" disabled={loading} className="sf-btn sf-btn-primary">
                {loading ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
