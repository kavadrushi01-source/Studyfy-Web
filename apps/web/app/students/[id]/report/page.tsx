"use client";

import { useState, type FormEvent } from "react";
import { SkeletonBlocks } from "../../../../components/ui/shell";

// Report card viewer (§7 Phase 1 #4, print per §8.5). Fetches the PDF with
// the pasted token and opens it in a new tab — the browser's print dialog
// inside the PDF viewer is the print path by design (report cards print
// from the PDF, pixel-faithful), so this page carries no print CSS.
// Self-scope applies: students/parents can only open their own rows.
// Same token-paste dev workflow as the other pre-dashboard screens.
// Role-agnostic page: NOT wrapped in Shell (Shell requires a role prop —
// forcing one would badge the wrong role), so this page carries the
// light-canvas background, Inter font, and 1120/padding-28 rhythm directly.
export default function ReportCardPage() {
  const [schoolId, setSchoolId] = useState("");
  const [examId, setExamId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function open(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/exams/${examId}/report-cards/${studentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const win = window.open(url, "_blank", "noopener");
      if (!win) {
        setError("PDF is ready, but the browser blocked the new tab — allow pop-ups for this site and try again.");
      }
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

  return (
    <main
      style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: 28,
        fontFamily: "Inter, system-ui, sans-serif",
        background: "#F8FAFC",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ color: "#0F172A" }}>Report Card</h1>
      <form onSubmit={open} style={{ ...card, maxWidth: 640 }}>
        <label>
          School ID
          <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
        </label>
        <label>
          Exam ID
          <input style={input} value={examId} onChange={(e) => setExamId(e.target.value)} required />
        </label>
        <label>
          Student ID
          <input style={input} value={studentId} onChange={(e) => setStudentId(e.target.value)} required />
        </label>
        <label>
          Bearer token (dev only — login screen replaces this)
          <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <button type="submit" disabled={loading} style={primaryBtn}>
          Open report card PDF
        </button>
      </form>
      {loading ? (
        <div style={{ marginTop: 16, maxWidth: 640 }}>
          <SkeletonBlocks rows={2} />
        </div>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
