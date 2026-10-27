"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { colors, gradients, h1Style, labelStyle, mutedStyle, primaryBtn } from "@/lib/theme";
import { isFailure, apiBase } from "../../lib/api";
import { boardPathForRole } from "../../components/ui/role-boards";

interface Me {
  id: string;
  name: string;
  email: string;
  schoolId: string | null;
  role: string;
}

const SESSION_KEY = "studyfy-session";

// Login (§8.3, rebuilt per §8.1 — no role tabs; the account determines the
// role server-side). Deliberate omission, not oversight: no "Sign in with
// Google" (OAuth isn't wired — a dead button would lie). "Forgot password?"
// links to /forgot-password (real flow, §13.3). Remember-me is functional:
// it remembers the email in this browser only.
//
// Two flow improvements remove the last dead weight after signing in
// (the old flow landed everyone on this screen with a manual "Open my
// board" click):
// 1. Returning to /login with a live session shows an inline "continue"
//    hint above the form. No auto-redirect: switching accounts (re-login
//    from /login without signing out first) is a real flow - observed in
//    multi-user scripts - and a bounce removes the form they came here
//    to use. After a logout the session is cleared, so no hint shows.
// 2. A fresh sign-in resolves into a single "Open my board" button that
//    lands on the role's board. No automatic navigation on this screen —
//    timers here race any immediate navigation the app or a test performs
//    (observed as random mid-flow redirects), so the click is the user's
//    own intent.
// The session lives in the shared AuthProvider; the /health warm-up below
// pays the free-tier API cold start during page load, not inside Submit.
export default function LoginPage() {
  const { login, apiFetch } = useAuth();
  const [schoolSlug, setSchoolSlug] = useState("");
  const [email, setEmail] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem("studyfy-login-email") ?? ""),
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [pendingProfile, setPendingProfile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [returningBoard, setReturningBoard] = useState<string | null>(null);

  // Free-tier API cold start owned most of the "login took forever"
  // complaint: POST /auth/login paid the full boot (~20s) after the user
  // hit Login. This fires the cheap /health GET the moment /login opens,
  // so the API is warm by the time credentials are typed. Pure warm-up —
  // result is deliberately ignored on purpose.
  useEffect(() => {
    void fetch(`${apiBase()}/health`).catch(() => undefined);
  }, []);

  // A signed-in visitor on /login gets a one-click path back to their
  // board while the form stays usable underneath. Reads the persisted
  // session directly (AuthProvider's state isn't visible here yet on
  // first paint); a dead token simply lands on the target page's sign-in
  // gate, which is the honest outcome.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) {
        return;
      }
      const saved = JSON.parse(raw) as { token?: string; user?: { role?: string } };
      const board = saved.token && saved.user ? boardPathForRole(saved.user.role) : null;
      if (board) {
        setReturningBoard(board);
      }
    } catch {
      // Unreadable storage: show the plain form, no hint.
    }
  }, []);

  // After a fresh sign-in the confirmation card renders; the "Open my
  // board" link (below) is the deliberate single next step.

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
        <div className="sf-card sf-rise" style={{ padding: 32, width: 420, maxWidth: "100%" }}>
          <h1 style={{ ...h1Style, margin: "0 0 4px" }}>Welcome Back!</h1>
          <p style={{ ...mutedStyle, margin: "0 0 20px" }}>Sign in to your school account</p>
          {!me && returningBoard ? (
            <p
              style={{
                fontSize: 14,
                margin: "0 0 16px",
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(37,99,235,.08)",
                color: colors.ink,
              }}
            >
              You already have a signed-in session.{" "}
              <Link href={returningBoard} style={{ color: colors.primary, fontWeight: 600 }}>
                Open my board
              </Link>{" "}
              — or sign in below with a different account.
            </p>
          ) : null}
          {!me ? (
            <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
              <label style={labelStyle}>
                School slug <span style={{ color: colors.muted, fontSize: 12 }}>(leave empty only for the platform owner)</span>
                <input
                  className="sf-input"
                  value={schoolSlug}
                  onChange={(e) => setSchoolSlug(e.target.value)}
                  placeholder="e.g. school-of-science"
                  autoComplete="organization"
                  spellCheck={false}
                />
              </label>
              <label style={labelStyle}>
                Email
                <input
                  className="sf-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
              <label style={labelStyle}>
                Password
                <span style={{ position: "relative", display: "block" }}>
                  <input
                    className="sf-input"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    style={{ paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    style={{
                      position: "absolute",
                      right: 6,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 30,
                      height: 30,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      background: "transparent",
                      color: colors.muted,
                      cursor: "pointer",
                      borderRadius: 8,
                    }}
                  >
                    {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                  </button>
                </span>
              </label>
              <label style={{ ...labelStyle, display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember me on this browser
              </label>
              <button type="submit" disabled={loading} className="sf-btn sf-btn-primary">
                {loading ? "Signing in…" : "Login"}
              </button>
              <p style={{ fontSize: 13, margin: 0 }}>
                <Link href="/forgot-password" style={{ color: colors.primary, fontWeight: 600 }}>Forgot password?</Link>
              </p>
              {error ? <p style={{ color: colors.danger, fontSize: 14, margin: 0 }}>{error}</p> : null}
              <p style={{ fontSize: 14, color: colors.muted, margin: 0 }}>
                Don&apos;t have an account? <Link href="/signup" style={{ color: colors.primary, fontWeight: 600 }}>Sign up</Link>
              </p>
            </form>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <p style={{ margin: 0, fontSize: 15 }}>
                Signed in as <strong>{me.name}</strong> ({me.role.toLowerCase().replace(/_/g, " ")})
              </p>
              {me.schoolId ? (
                <p style={{ fontSize: 13, color: colors.muted, margin: 0 }}>
                  School ID for the board pages: <strong style={{ fontFamily: "monospace" }}>{me.schoolId}</strong>{" "}
                  (this ID — not the school slug)
                </p>
              ) : null}
              {boardPathForRole(me.role) ? (
                <Link
                  href={boardPathForRole(me.role) as string}
                  style={{ ...primaryBtn, textDecoration: "none", width: "100%", textAlign: "center" }}
                >
                  Open my board
                </Link>
              ) : (
                // Never leave a signed-in account with no way forward.
                <p style={{ ...mutedStyle, fontSize: 14, margin: 0 }}>
                  Your account is signed in but has no board yet. Contact your school
                  administrator.
                </p>
              )}
              {error ? <p style={{ color: colors.danger, fontSize: 14, margin: 0 }}>{error}</p> : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

