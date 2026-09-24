"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { isFailure } from "../../lib/api";

interface Me {
  id: string;
  name: string;
  email: string;
  schoolId: string | null;
  role: string;
}

const PRIMARY = "#2563EB";
const NAVY = "#0F172A";
const DANGER = "#DC2626";

const DASHBOARD_BY_ROLE: Record<string, string> = {
  SCHOOL_ADMIN: "/dashboard",
  TEACHER: "/dashboard/teacher",
  ACCOUNTANT: "/dashboard/accountant",
  STUDENT: "/dashboard/student",
  PARENT: "/dashboard/parent",
  PLATFORM_OWNER: "/dashboard/owner",
};

// Login (§8.3, rebuilt per §8.1 — no role tabs; the account determines the
// role server-side). Deliberate omissions, not oversights: no "Sign in with
// Google" (OAuth isn't wired — a dead button would lie), no "Forgot
// password?" (no reset flow exists yet). Remember-me is functional: it
// remembers the email in this browser only. After signing in, the page
// hands over the access token for the dashboard boards plus a direct link
// to the signer's own board.
export default function LoginPage() {
  const [schoolSlug, setSchoolSlug] = useState("");
  const [email, setEmail] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem("studyfy-login-email") ?? ""),
  );
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const loginRes = await fetch(`${api}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(schoolSlug.trim().length > 0 ? { schoolSlug: schoolSlug.trim() } : {}),
        }),
      });
      const loginBody = (await loginRes.json()) as
        | { data: { accessToken: string } }
        | { error: { code: string; message: string } };
      if (isFailure(loginRes, loginBody)) {
        throw new Error(loginBody.error?.message ?? "Sign-in failed.");
      }
      const accessToken = loginBody.data.accessToken;
      const meRes = await fetch(`${api}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const meBody = (await meRes.json()) as { data: { user: Me } } | { error: { message: string } };
      if (isFailure(meRes, meBody)) {
        throw new Error("Signed in, but could not load your profile.");
      }
      if (remember && typeof window !== "undefined") {
        window.localStorage.setItem("studyfy-login-email", email);
      }
      setToken(accessToken);
      setMe(meBody.data.user);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  async function copyToken(): Promise<void> {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setError("Copy failed — select the token text manually.");
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
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 32, width: 420, maxWidth: "100%" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 4px", color: NAVY }}>Welcome Back!</h1>
          <p style={{ fontSize: 14, color: "#64748B", margin: "0 0 20px" }}>Sign in to your school account</p>
          {!me ? (
            <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                School slug <span style={{ color: "#64748B", fontSize: 12 }}>(leave empty only for the platform owner)</span>
                <input value={schoolSlug} onChange={(e) => setSchoolSlug(e.target.value)} placeholder="e.g. school-of-science" style={input} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={input} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={input} />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember me on this browser
              </label>
              <button type="submit" disabled={loading} style={{ padding: 12, borderRadius: 10, border: 0, background: PRIMARY, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                {loading ? "Signing in…" : "Login"}
              </button>
              {error ? <p style={{ color: DANGER, fontSize: 14, margin: 0 }}>{error}</p> : null}
              <p style={{ fontSize: 14, color: "#64748B", margin: 0 }}>
                Don&apos;t have an account? <Link href="/signup" style={{ color: PRIMARY, fontWeight: 600 }}>Sign up</Link>
              </p>
            </form>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <p style={{ margin: 0, fontSize: 15 }}>
                Signed in as <strong>{me.name}</strong> ({me.role.toLowerCase().replace(/_/g, " ")})
              </p>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Your access token — paste it into any board
                <textarea readOnly value={token} rows={4} style={{ ...input, fontFamily: "monospace", fontSize: 12 }} />
              </label>
              {me.schoolId ? (
                <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>
                  School ID for the board pages: <strong style={{ fontFamily: "monospace" }}>{me.schoolId}</strong>{" "}
                  (this ID — not the school slug)
                </p>
              ) : null}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={copyToken} style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", fontWeight: 600, cursor: "pointer" }}>
                  {copied ? "Copied!" : "Copy token"}
                </button>
                {DASHBOARD_BY_ROLE[me.role] ? (
                  <Link href={DASHBOARD_BY_ROLE[me.role] as string} style={{ flex: 1, textAlign: "center", padding: 10, borderRadius: 10, background: PRIMARY, color: "#fff", fontWeight: 600, textDecoration: "none" }}>
                    Open my board
                  </Link>
                ) : null}
              </div>
              {error ? <p style={{ color: DANGER, fontSize: 14, margin: 0 }}>{error}</p> : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
