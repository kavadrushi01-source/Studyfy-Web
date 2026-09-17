"use client";

import { useState, type FormEvent } from "react";

interface Guardian {
  relationship: string;
  parent: { name: string; email: string };
}

interface StudentProfile {
  id: string;
  sectionId: string;
  admissionNo: string | null;
  rollNumber: number | null;
  dob: string | null;
  gender: string | null;
  user: { name: string; email: string };
  guardianLinks: Guardian[];
}

interface ApiError {
  error: { code: string; message: string };
}

// Pre-dashboard profile screen (Phase 1 Chunk 1). What you see is decided
// server-side by self-scope: a student gets their own record, a parent
// their linked children, staff any in-school record — anything else is a
// 403 from the API, and this screen surfaces that message as-is.
// Auth UI doesn't exist yet, so a bearer token is pasted (dev workflow
// only — the login screen replaces this in the dashboard chunk).
export default function StudentProfilePage() {
  const [schoolId, setSchoolId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [error, setError] = useState("");

  async function onLoad(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setProfile(null);
    setError("");
    try {
      const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/students/${studentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json()) as { data: { student: StudentProfile } } | ApiError;
      if (!response.ok || "error" in body) {
        setError((body as ApiError).error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setProfile((body as { data: { student: StudentProfile } }).data.student);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  const input = { display: "block", width: "100%", margin: "4px 0 12px", padding: 8 } as const;

  return (
    <main style={{ maxWidth: 560, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Student Profile</h1>
      <form onSubmit={onLoad}>
        <label>
          School ID
          <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
        </label>
        <label>
          Student ID
          <input style={input} value={studentId} onChange={(e) => setStudentId(e.target.value)} required />
        </label>
        <label>
          Bearer token (dev only — login screen replaces this)
          <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "Loading…" : "Load profile"}
        </button>
      </form>
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
      {profile ? (
        <section style={{ marginTop: 16, border: "1px solid #0D9488", padding: 12 }}>
          <h2>{profile.user.name}</h2>
          <p>{profile.user.email}</p>
          <dl>
            <dt>Admission no.</dt>
            <dd>{profile.admissionNo ?? "—"}</dd>
            <dt>Roll no.</dt>
            <dd>{profile.rollNumber ?? "—"}</dd>
            <dt>Date of birth</dt>
            <dd>{profile.dob ? new Date(profile.dob).toLocaleDateString("en-GB") : "—"}</dd>
            <dt>Gender</dt>
            <dd>{profile.gender ?? "—"}</dd>
          </dl>
          <h3>Guardians</h3>
          {profile.guardianLinks.length === 0 ? (
            <p>None linked.</p>
          ) : (
            <ul>
              {profile.guardianLinks.map((g) => (
                <li key={g.parent.email}>
                  {g.parent.name} ({g.relationship}) — {g.parent.email}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}
