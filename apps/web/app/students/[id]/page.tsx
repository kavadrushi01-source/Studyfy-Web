"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";

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

// Profile screen (Phase 1 Chunk 1). What you see is decided server-side by
// self-scope: a student gets their own record, a parent their linked
// children, staff any in-school record — anything else is a 403 from the
// API, and this screen surfaces that message as-is. Identity comes from
// the shared session (useAuth) — apiFetch attaches the bearer token.
// Role-agnostic page: NOT wrapped in Shell (Shell requires a role prop —
// forcing one would badge the wrong role), so this page carries the
// light-canvas background, Inter font, and 1120/padding-28 rhythm directly.
export default function StudentProfilePage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [error, setError] = useState("");

  async function onLoad(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      setError("Please sign in to load a profile.");
      return;
    }
    setLoading(true);
    setProfile(null);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/students/${studentId}`);
      const body = (await response.json()) as { data: { student: StudentProfile } } | ApiError;
      if (isFailure(response, body)) {
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
  const primaryBtn = {
    background: "#2563EB",
    color: "#fff",
    border: "1px solid #2563EB",
    borderRadius: 8,
    padding: "8px 16px",
    cursor: "pointer",
  } as const;
  const card = {
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 1px 3px rgba(15,23,42,.08)",
    padding: 20,
  } as const;

  const frame = {
    maxWidth: 1120,
    margin: "0 auto",
    padding: 28,
    fontFamily: "Inter, system-ui, sans-serif",
    background: "#F8FAFC",
    minHeight: "100vh",
  } as const;

  if (!ready) {
    return (
      <main style={frame}>
        <h1 style={{ color: "#0F172A" }}>Student Profile</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={frame}>
        <h1 style={{ color: "#0F172A" }}>Student Profile</h1>
        <div style={{ ...card, maxWidth: 640 }}>
          <p style={{ color: "#334155" }}>Please sign in to view a profile.</p>
          <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={frame}>
      <h1 style={{ color: "#0F172A" }}>Student Profile</h1>
      <form onSubmit={onLoad} style={{ ...card, maxWidth: 640 }}>
        <label>
          Student ID
          <input style={input} value={studentId} onChange={(e) => setStudentId(e.target.value)} required />
        </label>
        <button type="submit" disabled={loading} style={primaryBtn}>
          Load profile
        </button>
      </form>
      {loading ? (
        <div style={{ marginTop: 16, maxWidth: 640 }}>
          <SkeletonBlocks rows={4} />
        </div>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
      {profile ? (
        <section style={{ ...card, marginTop: 16, maxWidth: 640 }}>
          <h2 style={{ color: "#0F172A", marginTop: 0 }}>{profile.user.name}</h2>
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
          <h3 style={{ color: "#0F172A" }}>Guardians</h3>
          {profile.guardianLinks.length === 0 ? (
            <p style={{ color: "#64748B" }}>None linked.</p>
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
