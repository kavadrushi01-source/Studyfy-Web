"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Plus, RefreshCw, Send } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";

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
  pending: { id: string; studentName: string }[] | null;
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
  const { token, schoolId, ready, apiFetch } = useAuth();
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
      // Subject dropdown for the post form (names, not IDs — typing a name
      // as an ID 404'd with "Subject not found in this school").
      const subjectsRes = await apiFetch(`/api/v1/schools/${schoolId}/subjects`);
      const subjectsBody = (await subjectsRes.json()) as {
        data: { subjects: { id: string; name: string }[] };
      } | ApiError;
      if (!isFailure(subjectsRes, subjectsBody)) {
        setSubjectOptions(subjectsBody.data.subjects);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, apiFetch]);

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

  async function gradeOne(submissionId: string): Promise<void> {
    if (!schoolId) {
      setError("Please sign in to grade a submission.");
      return;
    }
    setGradingId(submissionId);
    setError("");
    setNotice("");
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

  const page: React.CSSProperties = {
    maxWidth: 1120,
    margin: "0 auto",
    padding: 28,
    fontFamily: "Inter, system-ui, sans-serif",
    background: "#F8FAFC",
    minHeight: "100vh",
  };
  const input: React.CSSProperties = {
    display: "block",
    width: "100%",
    margin: "4px 0 12px",
    padding: 10,
    borderRadius: 10,
    border: "1px solid #CBD5E1",
  };
  const primaryBtn: React.CSSProperties = {
    background: "#2563EB",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "10px 16px",
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
  const quietBtn: React.CSSProperties = {
    background: "#fff",
    color: "#334155",
    border: "1px solid #E2E8F0",
    borderRadius: 10,
    padding: "10px 16px",
    fontWeight: 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
  const card: React.CSSProperties = {
    background: "#fff",
    borderRadius: 14,
    boxShadow: "0 1px 3px rgba(15,23,42,.08)",
    padding: 16,
    marginBottom: 12,
  };
  const pill = (color: string): React.CSSProperties => ({
    fontSize: 12,
    padding: "2px 10px",
    borderRadius: 999,
    border: `1px solid ${color}`,
    color,
  });

  const statusOf = (item: BoardItem): { label: string; color: string } => {
    if (item.counts) {
      const pending = item.counts.submitted - item.counts.graded;
      if (pending > 0) {
        return { label: `${pending} to grade`, color: "#D97706" };
      }
      return { label: item.counts.total === 0 ? "No submissions" : "All graded", color: "#059669" };
    }
    const mine = item.mySubmissions[0];
    if (!mine) {
      return { label: "Pending", color: "#D97706" };
    }
    return mine.status === "GRADED"
      ? { label: "Graded", color: "#059669" }
      : { label: "Submitted", color: "#2563EB" };
  };

  const sectionOptions = [...new Map(items.map((i) => [i.section.id, i.section])).values()];
  const empty = !loading && items.length === 0;

  if (!ready) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
          <BookOpen size={22} aria-hidden="true" color="#2563EB" /> Homework
        </h1>
        <SkeletonBlocks rows={3} height={96} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
          <BookOpen size={22} aria-hidden="true" color="#2563EB" /> Homework
        </h1>
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 20 }}>
          <p style={{ color: "#334155" }}>Please sign in to view homework.</p>
          <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={page}>
      <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
        <BookOpen size={22} aria-hidden="true" color="#2563EB" /> Homework
      </h1>
      <p style={{ color: "#64748B", margin: "0 0 20px", fontSize: 14 }}>
        One board per role — post it, submit it, grade it.
      </p>
      <div className="sf-row-wrap" style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => void load()} disabled={loading} style={{ ...quietBtn, opacity: loading ? 0.6 : 1 }}>
          <RefreshCw size={14} aria-hidden="true" /> Reload
        </button>
      </div>
      <section style={card}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px", color: "#0F172A", display: "flex", alignItems: "center", gap: 6 }}>
          <Plus size={16} aria-hidden="true" /> Post homework (teacher)
        </h2>
        <form onSubmit={postHomework}>
          <div className="sf-row-wrap">
            <label style={{ flex: 1, minWidth: 200 }}>
              Section
              {sectionOptions.length > 0 ? (
                <select
                  style={input}
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
                  style={input}
                  value={phSection}
                  onChange={(e) => setPhSection(e.target.value)}
                  placeholder="Section ID"
                  required
                  aria-label="Section ID"
                />
              )}
            </label>
            <label style={{ flex: 1, minWidth: 200 }}>
              Subject
              {subjectOptions.length > 0 ? (
                <select
                  style={input}
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
                  style={input}
                  value={phSubject}
                  onChange={(e) => setPhSubject(e.target.value)}
                  placeholder="Subject ID you teach"
                  required
                />
              )}
            </label>
            <label style={{ flex: 1, minWidth: 200 }}>
              Due date
              <input style={input} type="date" value={phDue} onChange={(e) => setPhDue(e.target.value)} required />
            </label>
          </div>
          <label>
            Title
            <input
              style={input}
              value={phTitle}
              onChange={(e) => setPhTitle(e.target.value)}
              placeholder="Algebra Worksheet 2"
              required
            />
          </label>
          <label>
            Description
            <textarea
              style={{ ...input, minHeight: 72 }}
              value={phDesc}
              onChange={(e) => setPhDesc(e.target.value)}
              placeholder="Solve problems 21 through 40 from chapter 3 before Friday."
              required
            />
          </label>
          <button type="submit" disabled={posting} style={{ ...primaryBtn, opacity: posting ? 0.6 : 1 }}>
            <Plus size={14} aria-hidden="true" /> {posting ? "Posting…" : "Post homework"}
          </button>
        </form>
      </section>
      <section style={card}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px", color: "#0F172A", display: "flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={16} aria-hidden="true" /> Grade submissions (teacher)
        </h2>
        {items.every((item) => (item.pending ?? []).length === 0) ? (
          <p style={{ color: "#64748B", fontSize: 14, margin: 0 }}>Nothing waiting for a grade right now.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {items.flatMap((item) =>
              (item.pending ?? []).map((sub) => (
                <li
                  key={sub.id}
                  style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid #F1F5F9", fontSize: 14 }}
                >
                  <span style={{ flex: 1, color: "#0F172A" }}>
                    {sub.studentName} <span style={{ color: "#64748B" }}>· {item.title}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void gradeOne(sub.id)}
                    disabled={gradingId === sub.id}
                    style={{ ...quietBtn, opacity: gradingId === sub.id ? 0.6 : 1 }}
                  >
                    <CheckCircle2 size={14} aria-hidden="true" /> {gradingId === sub.id ? "Grading…" : "Mark graded"}
                  </button>
                </li>
              )),
            )}
          </ul>
        )}
      </section>
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
                <h3 style={{ margin: 0, flex: 1 }}>{item.title}</h3>
                <span style={pill(status.color)}>{status.label}</span>
              </div>
              <p style={{ color: "#334155" }}>{item.description}</p>
              <small style={{ color: "#64748B" }}>
                {item.subject.name} · {item.section.className} {item.section.name} · {item.teacher.name} · due{" "}
                {fmtDue(item.dueDate)}
              </small>
              <div style={{ marginTop: 12, borderTop: "1px solid #F1F5F9", paddingTop: 12 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                  Your answer (student)
                </label>
                <textarea
                  style={{ ...input, minHeight: 64 }}
                  value={contents[item.id] ?? ""}
                  onChange={(e) => setContents((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  placeholder="Type your answers here…"
                  aria-label={`Answer for ${item.title}`}
                />
                <div className="sf-row-wrap">
                  <input
                    ref={(el) => {
                      fileRefs.current[item.id] = el;
                    }}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.pdf"
                    onChange={(e) => setFiles((prev) => ({ ...prev, [item.id]: e.target.files?.[0] ?? null }))}
                    aria-label={`File for ${item.title}`}
                  />
                  <button
                    type="button"
                    onClick={() => void submitItem(item.id)}
                    disabled={busy}
                    style={{ ...quietBtn, opacity: busy ? 0.6 : 1 }}
                  >
                    <Send size={14} aria-hidden="true" /> {busy ? "Submitting…" : "Submit"}
                  </button>
                </div>
              </div>
            </article>
          );
        })
      )}
      {notice ? <p style={{ color: "#059669" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
