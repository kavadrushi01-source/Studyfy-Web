"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
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
// role server-side). Deliberate omission, not oversight: no "Sign in with
// Google" (OAuth isn't wired — a dead button would lie). "Forgot password?"
// links to /forgot-password (real flow, §13.3). Remember-me is functional: it
// remembers the email in this browser only. After signing in, the page
// shows the signer's name plus a direct link to their own board; the
// session itself lives in the shared AuthProvider (no token paste).
export default function LoginPage() {
  const { login, apiFetch } = useAuth();
  const [schoolSlug, setSchoolSlug] = useState("");
  const [email, setEmail] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem("studyfy-login-email") ?? ""),
  );
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [pendingProfile, setPendingProfile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The shared session only becomes visible to apiFetch on the next render
  // after login(), so the profile fetch runs here with a fresh closure
  // instead of the stale one captured by submit().
  useEffect(() => {
    if (!pendingProfile) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const meRes = await apiFetch("/api/v1/auth/me");
        const meBody = (await meRes.json()) as { data: { user: Me } } | { error: { message: string } };
        if (isFailure(meRes, meBody)) {
          throw new Error("Signed in, but could not load your profile.");
        }
        if (!cancelled) {
          setMe(meBody.data.user);
          setPendingProfile(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Network error.");
          setPendingProfile(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingProfile, apiFetch]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const slug = schoolSlug.trim();
      await login({ email, password, ...(slug.length > 0 ? { schoolSlug: slug } : {}) });
      if (remember && typeof window !== "undefined") {
        window.localStorage.setItem("studyfy-login-email", email);
      }
      setPassword("");
      setPendingProfile(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
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
              <p style={{ fontSize: 13, margin: 0 }}>
                <Link href="/forgot-password" style={{ color: PRIMARY, fontWeight: 600 }}>Forgot password?</Link>
              </p>
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
              {me.schoolId ? (
                <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>
                  School ID for the board pages: <strong style={{ fontFamily: "monospace" }}>{me.schoolId}</strong>{" "}
                  (this ID — not the school slug)
                </p>
              ) : null}
              <div style={{ display: "flex", gap: 8 }}>
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
