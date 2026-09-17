"use client";

import { useState, type FormEvent } from "react";

interface AdmitSuccess {
  student: { id: string; user: { email: string; name: string } };
  studentTempPassword: string;
  guardians: { user: { email: string }; tempPassword: string | null }[];
}

interface ApiError {
  error: { code: string; message: string };
}

// Pre-dashboard admission form (Phase 1 Chunk 1). Posts to the SIS admission
// endpoint; mirrors its fields 1:1. Auth UI doesn't exist yet, so an admin
// pastes a bearer token (dev workflow only — the login screen replaces this
// in the dashboard chunk). Temp passwords are shown ONCE, like the API
// returns them once.
export default function AdmitStudentPage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [admissionNo, setAdmissionNo] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AdmitSuccess | null>(null);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);
    setError("");
    try {
      const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name,
          email,
          sectionId,
          admissionNo: admissionNo || undefined,
          guardians:
            guardianName && guardianEmail
              ? [{ name: guardianName, email: guardianEmail, relationship: "Guardian" }]
              : undefined,
        }),
      });
      const body = (await response.json()) as AdmitSuccess | ApiError;
      if (!response.ok || "error" in body) {
        setError((body as ApiError).error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setResult(body as AdmitSuccess);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  const input = { display: "block", width: "100%", margin: "4px 0 12px", padding: 8 } as const;

  return (
    <main style={{ maxWidth: 560, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Admit Student</h1>
      <form onSubmit={onSubmit}>
        <label>
          School ID
          <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
        </label>
        <label>
          Admin bearer token (dev only — login screen replaces this)
          <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <label>
          Full name
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email (student login)
          <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Section ID
          <input style={input} value={sectionId} onChange={(e) => setSectionId(e.target.value)} required />
        </label>
        <label>
          Admission no. (optional)
          <input style={input} value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} />
        </label>
        <label>
          Guardian name (optional)
          <input style={input} value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
        </label>
        <label>
          Guardian email (optional)
          <input style={input} type="email" value={guardianEmail} onChange={(e) => setGuardianEmail(e.target.value)} />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? "Admitting…" : "Admit student"}
        </button>
      </form>
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
      {result ? (
        <section style={{ marginTop: 16, border: "1px solid #0D9488", padding: 12 }}>
          <h2>Admitted — share once, then forget</h2>
          <p>
            {result.student.user.name} ({result.student.user.email})
          </p>
          <p>
            Student temp password: <code>{result.studentTempPassword}</code>
          </p>
          {result.guardians.map((g) => (
            <p key={g.user.email}>
              {g.user.email}: <code>{g.tempPassword ?? "(existing account — unchanged)"}</code>
            </p>
          ))}
        </section>
      ) : null}
    </main>
  );
}
