"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  cardStyle,
  colors,
  h1Style,
  h2Style,
  labelStyle,
  mutedStyle,
  pageFrame,
} from "@/lib/theme";

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

  const pageH1 = { ...h1Style, marginBottom: 14 };
  const alertStyle = {
    margin: "14px 0 0",
    padding: "10px 14px",
    borderRadius: 12,
    background: colors.dangerTint,
    border: "1px solid rgba(220,38,38,.28)",
    color: colors.danger,
    fontSize: 14,
  };
  const codeStyle = {
    background: "#EFF3F9",
    color: colors.ink,
    padding: "2px 7px",
    borderRadius: 7,
    fontSize: 13,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  };
  const bodyText = { margin: "0 0 8px", fontSize: 14, color: colors.inkSoft };

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={pageH1}>Admit Student</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={pageH1}>Admit Student</h1>
        <div style={{ ...cardStyle, maxWidth: 640 }}>
          <p style={{ ...mutedStyle, margin: "0 0 8px" }}>Please sign in to admit a student.</p>
          <Link
            href="/login"
            style={{ color: colors.primary, fontWeight: 600, fontSize: 14, textDecoration: "none" }}
          >
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={pageH1}>Admit Student</h1>
      <form
        onSubmit={onSubmit}
        className="sf-card"
        style={{ maxWidth: 640, padding: 20, display: "grid", gap: 14 }}
      >
        <div className="sf-form-2col">
          <label style={labelStyle}>
            Full name
            <input
              className="sf-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            Email (student login)
            <input
              className="sf-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
        </div>
        <div className="sf-form-2col">
          <label style={labelStyle}>
            Section
            {sectionOptions.length > 0 ? (
              <select
                className="sf-select"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                required
                aria-label="Section"
              >
                <option value="">— pick a section —</option>
                {sectionOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.className} {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="sf-input"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                required
                placeholder="Section ID"
                aria-label="Section ID"
              />
            )}
          </label>
          <label style={labelStyle}>
            Admission no. (optional)
            <input
              className="sf-input"
              value={admissionNo}
              onChange={(e) => setAdmissionNo(e.target.value)}
            />
          </label>
        </div>
        <div className="sf-form-2col">
          <label style={labelStyle}>
            Guardian name (optional)
            <input
              className="sf-input"
              value={guardianName}
              onChange={(e) => setGuardianName(e.target.value)}
            />
          </label>
          <label style={labelStyle}>
            Guardian email (optional)
            <input
              className="sf-input"
              type="email"
              value={guardianEmail}
              onChange={(e) => setGuardianEmail(e.target.value)}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="sf-btn sf-btn-primary"
          style={{ justifySelf: "start", marginTop: 2 }}
        >
          {submitting ? "Admitting…" : "Admit student"}
        </button>
      </form>
      {error ? (
        <p role="alert" style={alertStyle}>
          {error}
        </p>
      ) : null}
      {result ? (
        <section
          style={{ ...cardStyle, marginTop: 16, maxWidth: 640, borderColor: colors.success }}
        >
          <h2 style={{ ...h2Style, marginTop: 0 }}>Admitted — share once, then forget</h2>
          <p style={bodyText}>
            {result.student.user.name} ({result.student.user.email})
          </p>
          <p style={bodyText}>
            Student temp password: <code style={codeStyle}>{result.studentTempPassword}</code>
          </p>
          {result.guardians.map((g) => (
            <p key={g.user.email} style={bodyText}>
              {g.user.email}: <code style={codeStyle}>{g.tempPassword ?? "(existing account — unchanged)"}</code>
            </p>
          ))}
        </section>
      ) : null}
    </main>
  );
}
