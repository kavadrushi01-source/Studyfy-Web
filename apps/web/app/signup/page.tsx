"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { colors, gradients, h1Style, labelStyle, primaryBtn } from "@/lib/theme";
import { isFailure } from "../../lib/api";

// Registration wizard (§8.3): Step 1 School Details → Step 2 Admin Details
// → Step 3 Complete. The login slug auto-derives from the school name
// (editable). Posts to the existing POST /auth/register — the one route
// deliberately outside tenant middleware, since the school doesn't exist
// until this request creates it.
export default function SignupPage() {
  const [step, setStep] = useState(1);
  const [schoolName, setSchoolName] = useState("");
  const [schoolType, setSchoolType] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [result, setResult] = useState<{ id: string; slug: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  function onSchoolName(value: string): void {
    setSchoolName(value);
    if (!slugTouched) {
      setSlug(
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80),
      );
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${api}/api/v1/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolName,
          ...(schoolType.trim() ? { schoolType: schoolType.trim() } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(state.trim() ? { state: state.trim() } : {}),
          ...(slug.trim() ? { slug: slug.trim() } : {}),
          adminName,
          adminEmail,
          adminPassword,
        }),
      });
      const body = (await res.json()) as { data: { school: { id: string; slug: string } } } | { error: { message: string } };
      if (isFailure(res, body)) {
        throw new Error(body.error?.message ?? "Registration failed.");
      }
      setResult({ id: body.data.school.id, slug: body.data.school.slug });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  const steps = ["School Details", "Admin Details", "Complete"];
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
        <div className="sf-card" style={{ padding: 32, width: 520, maxWidth: "100%" }}>
          <h1 style={{ ...h1Style, margin: "0 0 4px" }}>Start your 14-day free trial</h1>
          <ol style={{ display: "flex", gap: 8, listStyle: "none", margin: "16px 0 20px", padding: 0 }}>
            {steps.map((label, index) => (
              <li key={label} style={{ flex: 1, fontSize: 12, fontWeight: step === index + 1 ? 700 : 400, color: step === index + 1 ? colors.primary : colors.muted }}>
                <div style={{ height: 4, borderRadius: 999, background: step >= index + 1 ? gradients.accent : colors.lineSoft, marginBottom: 4 }} />
                Step {index + 1}: {label}
              </li>
            ))}
          </ol>
          {step === 1 ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setStep(2);
              }}
              style={{ display: "grid", gap: 14 }}
            >
              <label style={labelStyle}>
                School Name
                <input className="sf-input" value={schoolName} onChange={(e) => onSchoolName(e.target.value)} required minLength={2} />
              </label>
              <label style={labelStyle}>
                Login slug <span style={{ color: colors.muted, fontSize: 12 }}>(auto-derived, editable)</span>
                <input className="sf-input" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} placeholder="my-school-name" />
              </label>
              <div className="sf-form-2col">
                <label style={labelStyle}>
                  School Type
                  <input className="sf-input" value={schoolType} onChange={(e) => setSchoolType(e.target.value)} placeholder="Co-ed secondary" />
                </label>
                <label style={labelStyle}>
                  Phone
                  <input className="sf-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </label>
              </div>
              <label style={labelStyle}>
                Email
                <input className="sf-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <div className="sf-form-2col">
                <label style={labelStyle}>
                  City
                  <input className="sf-input" value={city} onChange={(e) => setCity(e.target.value)} />
                </label>
                <label style={labelStyle}>
                  State
                  <input className="sf-input" value={state} onChange={(e) => setState(e.target.value)} />
                </label>
              </div>
              <button type="submit" className="sf-btn sf-btn-primary">
                Next →
              </button>
            </form>
          ) : null}
          {step === 2 ? (
            <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
              <label style={labelStyle}>
                Admin Name
                <input className="sf-input" value={adminName} onChange={(e) => setAdminName(e.target.value)} required minLength={2} />
              </label>
              <label style={labelStyle}>
                Admin Email
                <input className="sf-input" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required />
              </label>
              <label style={labelStyle}>
                Admin Password <span style={{ color: colors.muted, fontSize: 12 }}>(min 8 characters)</span>
                <input className="sf-input" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required minLength={8} />
              </label>
              {error ? <p style={{ color: colors.danger, fontSize: 14, margin: 0 }}>{error}</p> : null}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => setStep(1)} className="sf-btn sf-btn-secondary" style={{ flex: 1 }}>
                  ← Back
                </button>
                <button type="submit" disabled={loading} className="sf-btn sf-btn-primary" style={{ flex: 2 }}>
                  {loading ? "Creating…" : "Create school"}
                </button>
              </div>
            </form>
          ) : null}
          {step === 3 && result ? (
            <div style={{ display: "grid", gap: 12 }}>
              <p style={{ color: colors.success, fontWeight: 700, margin: 0 }}>Your school is ready!</p>
              <p style={{ fontSize: 14, color: colors.muted, margin: 0 }}>
                Sign in with your admin email and the login slug <strong>{result.slug}</strong> — your 14-day free trial has started.
              </p>
              <p style={{ fontSize: 13, color: colors.muted, margin: 0 }}>
                School ID for the board pages: <strong style={{ fontFamily: "monospace" }}>{result.id}</strong>{" "}
                (save this — boards ask for the ID, not the slug)
              </p>
              <Link href="/login" style={{ ...primaryBtn, textAlign: "center", textDecoration: "none" }}>
                Go to Login
              </Link>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
