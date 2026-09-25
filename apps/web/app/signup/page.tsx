"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { isFailure } from "../../lib/api";

const PRIMARY = "#2563EB";
const NAVY = "#0F172A";
const DANGER = "#DC2626";
const SUCCESS = "#059669";

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

  const input: React.CSSProperties = { padding: 10, borderRadius: 10, border: "1px solid #CBD5E1", fontSize: 14 };
  const steps = ["School Details", "Admin Details", "Complete"];

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
          <h1 style={{ fontSize: 24, margin: "0 0 4px", color: NAVY }}>Start your 14-day free trial</h1>
          <ol style={{ display: "flex", gap: 8, listStyle: "none", margin: "16px 0 20px", padding: 0 }}>
            {steps.map((label, index) => (
              <li key={label} style={{ flex: 1, fontSize: 12, fontWeight: step === index + 1 ? 700 : 400, color: step === index + 1 ? PRIMARY : "#64748B" }}>
                <div style={{ height: 4, borderRadius: 999, background: step >= index + 1 ? PRIMARY : "#E2E8F0", marginBottom: 4 }} />
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
              style={{ display: "grid", gap: 12 }}
            >
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                School Name
                <input value={schoolName} onChange={(e) => onSchoolName(e.target.value)} required minLength={2} style={input} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Login slug <span style={{ color: "#64748B", fontSize: 12 }}>(auto-derived, editable)</span>
                <input value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} placeholder="my-school-name" style={input} />
              </label>
              <div className="sf-form-2col">
                <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                  School Type
                  <input value={schoolType} onChange={(e) => setSchoolType(e.target.value)} placeholder="Co-ed secondary" style={input} />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                  Phone
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} style={input} />
                </label>
              </div>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
              </label>
              <div className="sf-form-2col">
                <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                  City
                  <input value={city} onChange={(e) => setCity(e.target.value)} style={input} />
                </label>
                <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                  State
                  <input value={state} onChange={(e) => setState(e.target.value)} style={input} />
                </label>
              </div>
              <button type="submit" style={{ padding: 12, borderRadius: 10, border: 0, background: PRIMARY, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                Next →
              </button>
            </form>
          ) : null}
          {step === 2 ? (
            <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Admin Name
                <input value={adminName} onChange={(e) => setAdminName(e.target.value)} required minLength={2} style={input} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Admin Email
                <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required style={input} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
                Admin Password <span style={{ color: "#64748B", fontSize: 12 }}>(min 8 characters)</span>
                <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required minLength={8} style={input} />
              </label>
              {error ? <p style={{ color: DANGER, fontSize: 14, margin: 0 }}>{error}</p> : null}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => setStep(1)} style={{ flex: 1, padding: 12, borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", fontWeight: 600, cursor: "pointer" }}>
                  ← Back
                </button>
                <button type="submit" disabled={loading} style={{ flex: 2, padding: 12, borderRadius: 10, border: 0, background: PRIMARY, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                  {loading ? "Creating…" : "Create school"}
                </button>
              </div>
            </form>
          ) : null}
          {step === 3 && result ? (
            <div style={{ display: "grid", gap: 12 }}>
              <p style={{ color: SUCCESS, fontWeight: 700, margin: 0 }}>Your school is ready!</p>
              <p style={{ fontSize: 14, color: "#475569", margin: 0 }}>
                Sign in with your admin email and the login slug <strong>{result.slug}</strong> — your 14-day free trial has started.
              </p>
              <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>
                School ID for the board pages: <strong style={{ fontFamily: "monospace" }}>{result.id}</strong>{" "}
                (save this — boards ask for the ID, not the slug)
              </p>
              <Link href="/login" style={{ textAlign: "center", padding: 12, borderRadius: 10, background: PRIMARY, color: "#fff", fontWeight: 600, textDecoration: "none" }}>
                Go to Login
              </Link>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
