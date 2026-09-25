"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { isFailure } from "../../lib/api";

const PRIMARY = "#2563EB";
const NAVY = "#0F172A";
const DANGER = "#DC2626";
const SUCCESS = "#059669";

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
          <h1 style={{ fontSize: 24, margin: "0 0 4px", color: NAVY }}>Set a new password</h1>
          <p style={{ fontSize: 14, color: "#64748B", margin: "0 0 20px" }}>Paste the token from your reset email.</p>
          {done ? (
            <div style={{ display: "grid", gap: 12 }}>
              <p style={{ color: SUCCESS, fontWeight: 600, margin: 0 }}>Password updated — all other sessions were signed out.</p>
              <Link href="/login" style={{ textAlign: "center", padding: 12, borderRadius: 10, background: PRIMARY, color: "#fff", fontWeight: 600, textDecoration: "none" }}>
                Back to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Reset token
                <input value={token} onChange={(e) => setToken(e.target.value)} required minLength={16} style={{ ...input, fontFamily: "monospace", fontSize: 12 }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                New password <span style={{ color: "#64748B", fontSize: 12 }}>(min 8 characters)</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} style={input} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Confirm new password
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} style={input} />
              </label>
              {error ? <p style={{ color: DANGER, fontSize: 14, margin: 0 }}>{error}</p> : null}
              <button type="submit" disabled={loading} style={{ padding: 12, borderRadius: 10, border: 0, background: PRIMARY, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                {loading ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
