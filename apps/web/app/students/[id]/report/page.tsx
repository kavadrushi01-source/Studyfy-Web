"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SkeletonBlocks } from "../../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, h2Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

interface ExamOption {
  id: string;
  name: string;
}

interface RemarkRow {
  id: string;
  remark: string;
  generatedBy: string;
  reviewed: boolean;
  createdAt: string;
}

// Report card viewer (7 Phase 1 #4, print per 8.5). The student comes from
// the route (/students/:id/report) - no paste box - and the exam is picked
// from the school's exam list. Fetches the PDF with the shared session and
// opens it in a new tab - the browser's print dialog inside the PDF viewer
// is the print path by design (report cards print from the PDF,
// pixel-faithful), so this page carries no print CSS.
// Self-scope applies: students/parents can only open their own rows.
// Role-agnostic page: NOT wrapped in Shell (Shell requires a role prop -
// forcing one would badge the wrong role), so this page carries the
// light-canvas background, Inter font, and 1120/padding-28 rhythm directly.
export default function ReportCardPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const params = useParams<{ id: string }>();
  const studentId = typeof params.id === "string" ? params.id : "";
  const [examId, setExamId] = useState("");
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Teacher review (§7 Phase 3 #18): staff-only. Pupils/parents see the
  // signed remark on the PDF itself — they never reach this section.
  const canReview = user?.role === "SCHOOL_ADMIN" || user?.role === "TEACHER";
  const [remarks, setRemarks] = useState<RemarkRow[]>([]);
  const [remarksLoading, setRemarksLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reviewBusy, setReviewBusy] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch(`/api/v1/schools/${schoolId}/exams`);
        const body = (await response.json()) as
          | { data: { exams: ExamOption[] } }
          | { error?: { message?: string } };
        if (!cancelled && "data" in body && Array.isArray(body.data.exams)) {
          setExams(body.data.exams);
        }
      } catch {
        // The form stays usable: the select simply shows no exams.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, token, schoolId, apiFetch]);

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

  async function loadRemarks(nextExamId: string): Promise<void> {
    if (!schoolId || !canReview || !nextExamId) {
      return;
    }
    setRemarksLoading(true);
    setReviewNotice("");
    try {
      const response = await apiFetch(
        `/api/v1/schools/${schoolId}/exams/${nextExamId}/remarks?studentId=${encodeURIComponent(studentId)}`,
      );
      const body = (await response.json()) as { data: { remarks: RemarkRow[] } } | { error?: { message?: string } };
      if (!response.ok || !("data" in body)) {
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ?? "Failed to load remarks.",
        );
      }
      setRemarks(body.data.remarks);
      setDrafts(Object.fromEntries(body.data.remarks.map((r) => [r.id, r.remark])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setRemarksLoading(false);
    }
  }

  async function draftWithAi(): Promise<void> {
    if (!schoolId || !examId) {
      return;
    }
    setGenerating(true);
    setReviewNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/exams/${examId}/remarks/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      const body = (await response.json()) as { data?: unknown } | { error?: { message?: string } };
      if (!response.ok || !("data" in body)) {
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ?? "Draft generation failed.",
        );
      }
      await loadRemarks(examId);
      setReviewNotice("AI draft ready below — read it before marking reviewed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveRemarkText(remarkId: string): Promise<void> {
    if (!schoolId || !examId) {
      return;
    }
    setReviewBusy(remarkId);
    setReviewNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/exams/${examId}/remarks/${remarkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remark: drafts[remarkId] ?? "" }),
      });
      const body = (await response.json()) as { data?: unknown } | { error?: { message?: string } };
      if (!response.ok || !("data" in body)) {
        throw new Error((body as { error?: { message?: string } }).error?.message ?? "Save failed.");
      }
      await loadRemarks(examId);
      setReviewNotice("Remark text saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setReviewBusy("");
    }
  }

  async function markReviewed(remarkId: string): Promise<void> {
    if (!schoolId || !examId) {
      return;
    }
    setReviewBusy(remarkId);
    setReviewNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/exams/${examId}/remarks/${remarkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remark: drafts[remarkId] ?? "", reviewed: true }),
      });
      const body = (await response.json()) as { data?: unknown } | { error?: { message?: string } };
      if (!response.ok || !("data" in body)) {
        throw new Error((body as { error?: { message?: string } }).error?.message ?? "Review failed.");
      }
      await loadRemarks(examId);
      setReviewNotice("Marked reviewed — the signed text now prints on the report card.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setReviewBusy("");
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
        <label style={labelStyle}>
          Exam
          <select
            className="sf-input"
            value={examId}
            onChange={(e) => {
              setExamId(e.target.value);
              if (e.target.value) {
                void loadRemarks(e.target.value);
              } else {
                setRemarks([]);
              }
            }}
            required
          >
            <option value="">- pick an exam -</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.name}
              </option>
            ))}
          </select>
        </label>
        <p style={{ ...mutedStyle, margin: "12px 0 0", fontSize: 13 }}>
          Opens the PDF for the student in the page address — self-scope still applies.
        </p>
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
      {canReview && examId ? (
        <section className="sf-card" style={{ maxWidth: 640, padding: 20, marginTop: 16 }}>
          <h2 style={h2Style}>Report card remarks</h2>
          <p style={{ ...mutedStyle, fontSize: 13, margin: "0 0 12px" }}>
            AI drafts land unreviewed — read and edit each one before marking it reviewed. Only
            reviewed text prints on the report card.
          </p>
          <button
            type="button"
            onClick={() => void draftWithAi()}
            disabled={generating}
            style={{ ...primaryBtn, opacity: generating ? 0.6 : 1 }}
          >
            {generating ? "Drafting…" : "Draft with AI"}
          </button>
          {remarksLoading ? (
            <div style={{ marginTop: 12 }}>
              <SkeletonBlocks rows={2} />
            </div>
          ) : remarks.length === 0 ? (
            <p style={{ ...mutedStyle, fontSize: 14, margin: "12px 0 0" }}>
              No remarks for this exam yet — draft one with AI above.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 12 }}>
              {remarks.map((r) => (
                <li
                  key={r.id}
                  style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: 12, background: "#fff" }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <span
                      style={pill(
                        r.reviewed ? colors.success : colors.warning,
                        r.reviewed ? colors.successTint : colors.warningTint,
                      )}
                    >
                      {r.reviewed ? "Reviewed" : r.generatedBy === "AI" ? "AI draft — needs review" : "Teacher note"}
                    </span>
                  </div>
                  <label style={{ ...labelStyle, display: "block" }}>
                    Remark text
                    <textarea
                      className="sf-input"
                      style={{ width: "100%", minHeight: 72, marginTop: 4 }}
                      value={drafts[r.id] ?? ""}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      aria-label="Remark text"
                    />
                  </label>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => void saveRemarkText(r.id)}
                      disabled={reviewBusy === r.id}
                      className="sf-btn"
                    >
                      Save text
                    </button>
                    {!r.reviewed ? (
                      <button
                        type="button"
                        onClick={() => void markReviewed(r.id)}
                        disabled={reviewBusy === r.id}
                        className="sf-btn sf-btn-primary"
                      >
                        Mark reviewed
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {reviewNotice ? (
            <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{reviewNotice}</p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
