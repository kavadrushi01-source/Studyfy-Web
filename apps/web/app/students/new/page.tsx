"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";

interface AdmitSuccess {
  student: { id: string; user: { email: string; name: string } };
  studentTempPassword: string;
  guardians: { user: { email: string }; tempPassword: string | null }[];
}

interface ApiError {
  error: { code: string; message: string };
}

// Admission form (Phase 1 Chunk 1). Posts to the SIS admission endpoint;
// mirrors its fields 1:1. Identity comes from the shared session (useAuth)
// — apiFetch attaches the bearer token and the school id. Temp passwords
// are shown ONCE, like the API returns them once.
// Role-agnostic staff page: NOT wrapped in Shell (Shell requires a role
// prop — forcing one would badge the wrong role), so this page carries the
// light-canvas background, Inter font, and 1120/padding-28 rhythm directly.
// Form submit keeps its button text by design (no skeleton for submits).
export default function AdmitStudentPage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [admissionNo, setAdmissionNo] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AdmitSuccess | null>(null);
  const [error, setError] = useState("");
  const [sectionOptions, setSectionOptions] = useState<{ id: string; name: string; className: string }[]>([]);

  // Section dropdown (names, not IDs — a typed ID 404s with
  // "Section not found in this school").
  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void (async () => {
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/sections`);
        const body = (await response.json()) as {
          data: { sections: { id: string; name: string; class: { name: string } }[] };
        } | ApiError;
        if (!isFailure(response, body)) {
          setSectionOptions(
            body.data.sections.map((s) => ({ id: s.id, name: s.name, className: s.class.name })),
          );
        }
      } catch {
        // Dropdown stays a text input below — posting still validates.
      }
    })();
  }, [ready, token, schoolId, apiFetch]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      setError("Please sign in to admit a student.");
      return;
    }
    setSubmitting(true);
    setResult(null);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      const body = (await response.json()) as { data: AdmitSuccess } | ApiError;
      if (isFailure(response, body)) {
        setError((body as ApiError).error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
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
        <h1 style={{ color: "#0F172A" }}>Admit Student</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={frame}>
        <h1 style={{ color: "#0F172A" }}>Admit Student</h1>
        <div style={{ ...card, maxWidth: 640 }}>
          <p style={{ color: "#334155" }}>Please sign in to admit a student.</p>
          <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={frame}>
      <h1 style={{ color: "#0F172A" }}>Admit Student</h1>
      <form onSubmit={onSubmit} style={{ ...card, maxWidth: 640 }}>
        <label>
          Full name
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email (student login)
          <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Section
          {sectionOptions.length > 0 ? (
            <select style={input} value={sectionId} onChange={(e) => setSectionId(e.target.value)} required aria-label="Section">
              <option value="">— pick a section —</option>
              {sectionOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.className} {s.name}
                </option>
              ))}
            </select>
          ) : (
            <input style={input} value={sectionId} onChange={(e) => setSectionId(e.target.value)} required placeholder="Section ID" aria-label="Section ID" />
          )}
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
          <input
            style={input}
            type="email"
            value={guardianEmail}
            onChange={(e) => setGuardianEmail(e.target.value)}
          />
        </label>
        <button type="submit" disabled={submitting} style={primaryBtn}>
          {submitting ? "Admitting…" : "Admit student"}
        </button>
      </form>
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
      {result ? (
        <section style={{ ...card, marginTop: 16, maxWidth: 640, border: "1px solid #059669" }}>
          <h2 style={{ color: "#0F172A", marginTop: 0 }}>Admitted — share once, then forget</h2>
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
