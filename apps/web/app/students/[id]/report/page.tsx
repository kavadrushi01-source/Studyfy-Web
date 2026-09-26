"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { SkeletonBlocks } from "../../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, labelStyle, mutedStyle, pageFrame } from "@/lib/theme";

// Report card viewer (§7 Phase 1 #4, print per §8.5). Fetches the PDF with
// the shared session and opens it in a new tab — the browser's print dialog
// inside the PDF viewer is the print path by design (report cards print
// from the PDF, pixel-faithful), so this page carries no print CSS.
// Self-scope applies: students/parents can only open their own rows.
// Role-agnostic page: NOT wrapped in Shell (Shell requires a role prop —
// forcing one would badge the wrong role), so this page carries the
// light-canvas background, Inter font, and 1120/padding-28 rhythm directly.
export default function ReportCardPage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [examId, setExamId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function open(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      setError("Please sign in to open a report card.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/exams/${examId}/report-cards/${studentId}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      // NOTE: "noopener" in the features string makes Chrome return null
      // even when the tab DID open, which turned every success into a false
      // "blocked" error. Open normally, then sever the opener ourselves.
      const win = window.open(url, "_blank");
      if (win) {
        win.opener = null;
      } else {
        setError("PDF is ready, but the browser blocked the new tab — allow pop-ups for this site and try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
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

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={pageH1}>Report Card</h1>
        <SkeletonBlocks rows={2} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={pageH1}>Report Card</h1>
        <div style={{ ...cardStyle, maxWidth: 640 }}>
          <p style={{ ...mutedStyle, margin: "0 0 8px" }}>Please sign in to open a report card.</p>
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
      <h1 style={pageH1}>Report Card</h1>
      <form onSubmit={open} className="sf-card" style={{ maxWidth: 640, padding: 20 }}>
        <div className="sf-form-2col">
          <label style={labelStyle}>
            Exam ID
            <input
              className="sf-input"
              value={examId}
              onChange={(e) => setExamId(e.target.value)}
              required
            />
          </label>
          <label style={labelStyle}>
            Student ID
            <input
              className="sf-input"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              required
            />
          </label>
        </div>
        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={loading} className="sf-btn sf-btn-primary">
            Open report card PDF
          </button>
        </div>
      </form>
      {loading ? (
        <div style={{ marginTop: 16, maxWidth: 640 }}>
          <SkeletonBlocks rows={2} />
        </div>
      ) : null}
      {error ? (
        <p role="alert" style={alertStyle}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
