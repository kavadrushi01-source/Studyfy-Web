"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Plus, RefreshCw, Send, WifiOff } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import {
  dataUrlToFile,
  dropQueued,
  enqueueSubmission,
  fileToDataUrl,
  readQueue,
  useOnlineStatus,
} from "@/lib/offline";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, h2Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn, secondaryBtn } from "@/lib/theme";

interface BoardItem {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  subject: { name: string };
  section: { id: string; name: string; className: string };
  teacher: { name: string };
  mySubmissions: { studentId: string; status: string }[];
  counts: { total: number; submitted: number; graded: number } | null;
  pending:
    | { id: string; studentName: string; content: string | null; fileUrl: string | null; submittedAt: string }[]
    | null;
}

interface ApiError {
  error: { code: string; message: string };
}

// Homework board (§7 Phase 1 #6). One call shapes rows per role: students
// split pending vs graded from mySubmissions, teachers see authored rows
// with needs-grading counts, admins everything. Posting, submitting (text
// + file), and grading all hit the real endpoints below — the board list
// keeps its status pills. Empty states are real cards per §8.5 — never a
// blank page, never a spinner. Identity comes from the shared session
// (useAuth).
export default function HomeworkPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  // Post form + grading queue are TEACHER-only: homework is given by
  // teachers, done by pupils, graded by teachers. Admins keep the
  // read-only board below (oversight) but never post or grade — the API
  // still gates by permission, this just keeps the options out of sight.
  const canManage = user?.role === "TEACHER";
  const [items, setItems] = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Post form (teacher): POST /schools/:schoolId/homework
  // { sectionId, subjectId, title, description, dueDate YYYY-MM-DD }.
  const [phSection, setPhSection] = useState("");
  const [phSubject, setPhSubject] = useState("");
  const [phTitle, setPhTitle] = useState("");
  const [phDesc, setPhDesc] = useState("");
  const [phDue, setPhDue] = useState("");
  const [posting, setPosting] = useState(false);
  // Submit UI (student): multipart content + file ("file") to
  // POST /schools/:schoolId/homework/:homeworkId/submissions.
  const [contents, setContents] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [submittingId, setSubmittingId] = useState("");
  const [subjectOptions, setSubjectOptions] = useState<{ id: string; name: string }[]>([]);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Offline queue (§7 Phase 3 #20): submissions started offline park on
  // this device and flush on reconnect. Nothing fails silently — queued
  // work shows a pill, flush failures show an error, and the queue stays.
  const online = useOnlineStatus();
  const [queuedIds, setQueuedIds] = useState<string[]>([]);
  const [flushing, setFlushing] = useState(false);
  const flushGuard = useRef(false);
  // Grade action (teacher): POST /schools/:schoolId/submissions/:id/grade.
  // Buttons render per pending submission from the board rows — no ID
  // hunting (ids come from the same call that shows the counts).
  const [gradingId, setGradingId] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/homework`);
      const body = (await response.json()) as { data: { homework: BoardItem[] } } | ApiError;
      if (isFailure(response, body)) {
        setError(body.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setItems(body.data.homework);
      // Subject dropdown for the post form (names, not IDs - typing a name
      // as an ID 404'd with "Subject not found in this school"). Staff-only:
      // pupils/parents get 403 from /subjects, so never ask.
      if (canManage) {
        const subjectsRes = await apiFetch(`/api/v1/schools/${schoolId}/subjects`);
        const subjectsBody = (await subjectsRes.json()) as {
          data: { subjects: { id: string; name: string }[] };
        } | ApiError;
        if (!isFailure(subjectsRes, subjectsBody)) {
          setSubjectOptions(subjectsBody.data.subjects);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, apiFetch, canManage]);

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void load();
  }, [ready, token, schoolId, apiFetch, load]);

  async function postHomework(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId) {
      setError("Please sign in to post homework.");
      return;
    }
    setPosting(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/homework`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: phSection.trim(),
          subjectId: phSubject.trim(),
          title: phTitle.trim(),
          description: phDesc.trim(),
          dueDate: phDue,
        }),
      });
      const body = (await response.json()) as { data: { homework: { id: string } } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Post failed.");
      }
      setPhSection("");
      setPhSubject("");
      setPhTitle("");
      setPhDesc("");
      setPhDue("");
      setNotice("Homework posted to the section board.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setPosting(false);
    }
  }

  async function submitItem(id: string): Promise<void> {
    if (!schoolId) {
      setError("Please sign in to submit homework.");
      return;
    }
    const content = (contents[id] ?? "").trim();
    const file = files[id] ?? null;
    if (!content && !file) {
      setError("Write an answer or attach a file first.");
      return;
    }
    // Offline: park it on this device instead of failing. The answer stays
    // in the box until the flush actually succeeds — never wiped on queue.
    if (!online && user?.role === "STUDENT" && user.id) {
      setError("");
      try {
        const item = {
          homeworkId: id,
          content,
          fileName: file?.name ?? null,
          fileType: file?.type ?? null,
          fileData: file ? await fileToDataUrl(file) : null,
          queuedAt: new Date().toISOString(),
        };
        setQueuedIds(enqueueSubmission(schoolId, user.id, item).map((q) => q.homeworkId));
        setNotice("Saved on this device — sends automatically when you reconnect.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not queue this submission.");
      }
      return;
    }
    setSubmittingId(id);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      if (content) {
        form.append("content", content);
      }
      if (file) {
        form.append("file", file);
      }
      // No Content-Type header: the browser sets the multipart boundary.
      const response = await apiFetch(`/api/v1/schools/${schoolId}/homework/${id}/submissions`, {
        method: "POST",
        body: form,
      });
      const body = (await response.json()) as { data: { submission: { id: string } } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Submit failed.");
      }
      setContents((prev) => ({ ...prev, [id]: "" }));
      setFiles((prev) => ({ ...prev, [id]: null }));
      const input = fileRefs.current[id];
      if (input) {
        input.value = "";
      }
      setNotice("Submitted — your teacher will grade it soon.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmittingId("");
    }
  }

  // Flush parked submissions FIFO. Success drops the row and clears the
  // box; failure keeps the row and says exactly which send failed — the
  // queue is never silently dropped.
  const flushQueue = useCallback(async () => {
    if (!schoolId || !user?.id || flushGuard.current) {
      return;
    }
    const pending = readQueue(schoolId, user.id);
    if (pending.length === 0) {
      return;
    }
    flushGuard.current = true;
    setFlushing(true);
    try {
      for (const item of pending) {
        const form = new FormData();
        if (item.content) {
          form.append("content", item.content);
        }
        if (item.fileData && item.fileName) {
          const restored = dataUrlToFile(item.fileData, item.fileName, item.fileType ?? "");
          if (!restored) {
            throw new Error("A queued file could not be rebuilt — it stays queued.");
          }
          form.append("file", restored);
        }
        const response = await apiFetch(`/api/v1/schools/${schoolId}/homework/${item.homeworkId}/submissions`, {
          method: "POST",
          body: form,
        });
        const body = (await response.json()) as { data?: unknown } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Queued send failed — it stays queued.");
        }
        setQueuedIds(dropQueued(schoolId, user.id, item.homeworkId, item.queuedAt).map((q) => q.homeworkId));
        setContents((prev) => ({ ...prev, [item.homeworkId]: "" }));
        setFiles((prev) => ({ ...prev, [item.homeworkId]: null }));
      }
      setNotice("Queued homework sent.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Queued send failed — it stays queued.");
    } finally {
      setFlushing(false);
      flushGuard.current = false;
    }
  }, [schoolId, apiFetch, user, load]);

  useEffect(() => {
    if (!schoolId || !user?.id) {
      return;
    }
    setQueuedIds(readQueue(schoolId, user.id).map((q) => q.homeworkId));
  }, [schoolId, user]);

  useEffect(() => {
    if (online && ready && token) {
      void flushQueue();
    }
  }, [online, ready, token, flushQueue]);

  async function gradeOne(submissionId: string): Promise<void> {
    if (!schoolId) {
      setError("Please sign in to grade a submission.");
      return;
    }
    setGradingId(submissionId);
    setError("");
    setNotice("");
    // Optimistic removal: the row vanishes the instant grading starts, so
    // a graded submission can never sit in the queue (or be graded twice)
    // while the confirmation round-trips. A failed grade reloads the true
    // board below, restoring the row with the error shown.
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        pending: (item.pending ?? []).filter((s) => s.id !== submissionId),
        counts: item.counts ? { ...item.counts, graded: item.counts.graded + 1 } : item.counts,
      })),
    );
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/submissions/${submissionId}/grade`, {
        method: "POST",
      });
      const body = (await response.json()) as { data: { submission: { id: string } } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Grading failed.");
      }
      setNotice("Submission marked as graded.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setGradingId("");
    }
  }

  function fmtDue(iso: string): string {
    const parsed = new Date(`${iso}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString("en-GB");
  }

  const card: React.CSSProperties = { ...cardStyle, marginBottom: 12 };
  const tintOf = (color: string): string =>
    color === colors.success
      ? colors.successTint
      : color === colors.warning
        ? colors.warningTint
        : color === colors.danger
          ? colors.dangerTint
          : colors.primaryGhost;
  const statusPill = (status: { label: string; color: string }): React.CSSProperties =>
    pill(status.color, tintOf(status.color));

  const statusOf = (item: BoardItem): { label: string; color: string } => {
    if (item.counts) {
      const pending = item.counts.submitted - item.counts.graded;
      if (pending > 0) {
        return { label: `${pending} to grade`, color: colors.warning };
      }
      return { label: item.counts.total === 0 ? "No submissions" : "All graded", color: colors.success };
    }
    const mine = item.mySubmissions[0];
    if (!mine) {
      return { label: "Pending", color: colors.warning };
    }
    return mine.status === "GRADED"
      ? { label: "Graded", color: colors.success }
      : { label: "Submitted", color: colors.primary };
  };

  const sectionOptions = [...new Map(items.map((i) => [i.section.id, i.section])).values()];
  const empty = !loading && items.length === 0;

  const titleStyle: React.CSSProperties = { ...h1Style, display: "flex", alignItems: "center", gap: 8 };

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...titleStyle, margin: "0 0 12px" }}>
          <BookOpen size={22} aria-hidden="true" color={colors.primary} /> Homework
        </h1>
        <SkeletonBlocks rows={3} height={96} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...titleStyle, margin: "0 0 12px" }}>
          <BookOpen size={22} aria-hidden="true" color={colors.primary} /> Homework
        </h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to view homework.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={titleStyle}>
        <BookOpen size={22} aria-hidden="true" color={colors.primary} /> Homework
      </h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        One board per role — post it, submit it, grade it.
      </p>
      {!online ? (
        <div
          role="status"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "#FFFBEB",
            border: "1px solid #F59E0B",
            color: "#92400E",
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 12,
          }}
        >
          <WifiOff size={16} aria-hidden="true" />
          You&apos;re offline — answers you submit now queue on this device and send when you reconnect.
          {flushing ? " Sending…" : null}
        </div>
      ) : null}
      <div className="sf-row-wrap" style={{ marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{ ...secondaryBtn, opacity: loading ? 0.6 : 1 }}
        >
          <RefreshCw size={14} aria-hidden="true" /> Reload
        </button>
      </div>
      {canManage ? (
      <>
      <section style={card}>
        <h2 style={{ ...h2Style, display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={16} aria-hidden="true" color={colors.primary} /> Post homework (teacher)
        </h2>
        <form onSubmit={postHomework} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="sf-row-wrap">
            <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
              Section
              {sectionOptions.length > 0 ? (
                <select
                  className="sf-select"
                  value={phSection}
                  onChange={(e) => setPhSection(e.target.value)}
                  aria-label="Section ID"
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
                  value={phSection}
                  onChange={(e) => setPhSection(e.target.value)}
                  placeholder="Section ID"
                  required
                  aria-label="Section ID"
                />
              )}
            </label>
            <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
              Subject
              {subjectOptions.length > 0 ? (
                <select
                  className="sf-select"
                  value={phSubject}
                  onChange={(e) => setPhSubject(e.target.value)}
                  aria-label="Subject"
                >
                  <option value="">— pick a subject —</option>
                  {subjectOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="sf-input"
                  value={phSubject}
                  onChange={(e) => setPhSubject(e.target.value)}
                  placeholder="Subject ID you teach"
                  required
                />
              )}
            </label>
            <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
              Due date
              <input className="sf-input" type="date" value={phDue} onChange={(e) => setPhDue(e.target.value)} required />
            </label>
          </div>
          <label style={labelStyle}>
            Title
            <input
              className="sf-input"
              value={phTitle}
              onChange={(e) => setPhTitle(e.target.value)}
              placeholder="Algebra Worksheet 2"
              required
            />
          </label>
          <label style={labelStyle}>
            Description
            <textarea
              className="sf-textarea"
              style={{ minHeight: 72, resize: "vertical" }}
              value={phDesc}
              onChange={(e) => setPhDesc(e.target.value)}
              placeholder="Solve problems 21 through 40 from chapter 3 before Friday."
              required
            />
          </label>
          <button
            type="submit"
            disabled={posting}
            style={{ ...primaryBtn, alignSelf: "flex-start", opacity: posting ? 0.6 : 1 }}
          >
            <Plus size={14} aria-hidden="true" /> {posting ? "Posting…" : "Post homework"}
          </button>
        </form>
      </section>
      <section style={card}>
        <h2 style={{ ...h2Style, display: "flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={16} aria-hidden="true" color={colors.success} /> Grade submissions (teacher)
        </h2>
        {loading ? (
          <SkeletonBlocks rows={1} height={52} />
        ) : items.every((item) => (item.pending ?? []).length === 0) ? (
          <p style={{ ...mutedStyle, margin: 0 }}>Nothing waiting for a grade right now.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {items.flatMap((item) =>
              (item.pending ?? []).map((sub) => (
                <li
                  key={sub.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    padding: "12px 0",
                    borderTop: `1px solid ${colors.lineSoft}`,
                    fontSize: 14,
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ flex: 1, color: colors.ink, fontWeight: 600 }}>
                      {sub.studentName} <span style={{ color: colors.muted, fontWeight: 400 }}>· {item.title}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void gradeOne(sub.id)}
                      disabled={gradingId === sub.id}
                      style={{ ...secondaryBtn, opacity: gradingId === sub.id ? 0.6 : 1 }}
                    >
                      <CheckCircle2 size={14} aria-hidden="true" /> {gradingId === sub.id ? "Grading…" : "Mark graded"}
                    </button>
                  </div>
                  {sub.content ? (
                    <p
                      style={{
                        margin: 0,
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "#F8FAFD",
                        border: `1px solid ${colors.lineSoft}`,
                        color: colors.inkSoft,
                        fontSize: 13,
                        lineHeight: 1.55,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {sub.content}
                    </p>
                  ) : null}
                  <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12, color: colors.muted }}>
                    <span>Submitted {new Date(sub.submittedAt).toLocaleString("en-GB")}</span>
                    {sub.fileUrl ? (
                      <>
                        <a
                          href={sub.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: colors.primary, fontWeight: 600, textDecoration: "none" }}
                        >
                          Open attached file
                        </a>
                        <a
                          href={sub.fileUrl}
                          download
                          style={{ color: colors.primary, fontWeight: 600, textDecoration: "none" }}
                        >
                          Download
                        </a>
                      </>
                    ) : (
                      <span>No file attached</span>
                    )}
                  </div>
                </li>
              )),
            )}
          </ul>
        )}
      </section>
      </>
      ) : null}
      {loading ? (
        <SkeletonBlocks rows={3} height={96} />
      ) : empty ? (
        <EmptyState
          icon={<BookOpen size={22} aria-hidden="true" />}
          title="Nothing pending"
          detail="No homework assigned here yet — you are all caught up."
        />
      ) : (
        items.map((item) => {
          const status = statusOf(item);
          const busy = submittingId === item.id;
          return (
            <article key={item.id} style={card}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <h3
                  style={{
                    margin: 0,
                    flex: 1,
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: "-0.015em",
                    color: colors.ink,
                  }}
                >
                  {item.title}
                </h3>
                <span style={statusPill(status)}>{status.label}</span>
                {queuedIds.includes(item.id) ? (
                  <span style={pill(colors.warning, colors.warningTint)}>Queued — sends on reconnect</span>
                ) : null}
              </div>
              <p style={{ color: colors.inkSoft, fontSize: 14, lineHeight: 1.55, margin: "10px 0 6px" }}>
                {item.description}
              </p>
              <small style={{ color: colors.muted, fontSize: 12 }}>
                {item.subject.name} · {item.section.className} {item.section.name} · {item.teacher.name} · due{" "}
                {fmtDue(item.dueDate)}
              </small>
              {user?.role === "STUDENT" ? (
              <div style={{ marginTop: 12, borderTop: `1px solid ${colors.lineSoft}`, paddingTop: 12 }}>
                <label
                  style={{ display: "block", fontSize: 13, fontWeight: 600, color: colors.inkSoft, marginBottom: 6 }}
                >
                  Your answer (student)
                </label>
                <textarea
                  className="sf-textarea"
                  style={{ minHeight: 64, resize: "vertical" }}
                  value={contents[item.id] ?? ""}
                  onChange={(e) => setContents((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  placeholder="Type your answers here…"
                  aria-label={`Answer for ${item.title}`}
                />
                <div className="sf-row-wrap" style={{ marginTop: 8 }}>
                  <input
                    ref={(el) => {
                      fileRefs.current[item.id] = el;
                    }}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.pdf"
                    onChange={(e) => setFiles((prev) => ({ ...prev, [item.id]: e.target.files?.[0] ?? null }))}
                    aria-label={`File for ${item.title}`}
                    style={{ fontSize: 13, color: colors.muted, padding: "6px 0" }}
                  />
                  <button
                    type="button"
                    onClick={() => void submitItem(item.id)}
                    disabled={busy}
                    style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}
                  >
                    <Send size={14} aria-hidden="true" /> {busy ? "Submitting…" : "Submit"}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: colors.muted, margin: "6px 0 0" }}>
                  One file only — real PDF or photo, max 2 MB. Renamed files that aren&apos;t really
                  PDFs/photos are rejected.
                </p>
              </div>
              ) : null}
            </article>
          );
        })
      )}
      {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
