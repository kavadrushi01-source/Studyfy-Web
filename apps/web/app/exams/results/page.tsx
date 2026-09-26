"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Award } from "lucide-react";
import { DataTable } from "../../../components/ui/data-table";
import { SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, h2Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

interface ExamOption {
  id: string;
  name: string;
  examSubjects: { id: string; maxMarks: number | string; subject: { name: string } }[];
}

interface ResultRow {
  studentId: string;
  name: string;
  total: number;
  max: number;
  percent: number;
  grade: string;
  rank: number;
}

interface ApiError {
  error: { code: string; message: string };
}

// Ranked results board (§7 Phase 1 #4, §11). Staff see the full class
// board; students/parents automatically see only their own/linked rows —
// no ID is ever specified here, the API defaults to the caller's pins
// (same rule as attendance). Top-K trims the board server-side but ranks
// always reflect the whole class. Grade pills follow §8.2. Identity comes
// from the shared session (useAuth).
export default function ExamResultsPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [examId, setExamId] = useState("");
  const [top, setTop] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [examName, setExamName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const canEnter = user?.role === "SCHOOL_ADMIN" || user?.role === "TEACHER";
  const [sections, setSections] = useState<{ id: string; name: string; className: string }[]>([]);
  const [entryExamId, setEntryExamId] = useState("");
  const [entrySubjectId, setEntrySubjectId] = useState("");
  const [entrySectionId, setEntrySectionId] = useState("");
  const [roster, setRoster] = useState<{ id: string; name: string }[]>([]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [entering, setEntering] = useState(false);
  const [entryNotice, setEntryNotice] = useState("");

  const loadExams = useCallback(async () => {
    if (!schoolId) {
      throw new Error("Please sign in to view results.");
    }
    const response = await apiFetch(`/api/v1/schools/${schoolId}/exams`);
    const body = (await response.json()) as { data: { exams: ExamOption[] } } | ApiError;
    if (isFailure(response, body)) {
      throw new Error(body.error?.message ?? "Failed to load exams.");
    }
    return body.data.exams;
  }, [schoolId, apiFetch]);

  const loadResults = useCallback(
    async (nextExam: string, nextTop: string) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (nextTop) {
          params.set("top", nextTop);
        }
        const query = params.toString();
        const response = await apiFetch(
          `/api/v1/schools/${schoolId}/exams/${nextExam}/results${query ? `?${query}` : ""}`,
        );
        const body = (await response.json()) as
          | { data: { exam: { name: string }; results: ResultRow[] } }
          | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load results.");
        }
        setRows(body.data.results);
        setExamName(body.data.exam.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  const loadEntrySections = useCallback(async (): Promise<void> => {
    if (!schoolId) {
      return;
    }
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/sections`);
      const body = (await response.json()) as {
        data: { sections: { id: string; name: string; class: { name: string } }[] };
      } | ApiError;
      if (!isFailure(response, body)) {
        setSections(body.data.sections.map((s) => ({ id: s.id, name: s.name, className: s.class.name })));
      }
    } catch {
      // Sections dropdown stays empty — entry still validates server-side.
    }
  }, [schoolId, apiFetch]);

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void (async () => {
      setError("");
      try {
        setExams(await loadExams());
        await loadEntrySections();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      }
    })();
  }, [ready, token, schoolId, loadExams, loadEntrySections]);

  function pickExam(event: React.ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value;
    setExamId(next);
    if (next) {
      void loadResults(next, top);
    }
  }

  // Marks entry (class teacher or admin — the API enforces the gate; the
  // form only renders for staff roles so pupils never see a dead form).
  const entryExam = exams.find((e) => e.id === entryExamId);
  const entrySubjects = entryExam?.examSubjects ?? [];

  async function loadEntryRoster(sectionId: string): Promise<void> {
    if (!schoolId) {
      return;
    }
    setError("");
    try {
      const params = new URLSearchParams({ sectionId, pageSize: "100", sort: "name", order: "asc" });
      const response = await apiFetch(`/api/v1/schools/${schoolId}/students?${params}`);
      const body = (await response.json()) as { data: { students: { id: string; name: string }[] } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Failed to load roster.");
      }
      setRoster(body.data.students);
      setMarks({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function saveMarks(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !entryExamId || !entrySubjectId || !entrySectionId) {
      return;
    }
    setEntering(true);
    setError("");
    setEntryNotice("");
    try {
      const records = roster
        .map((s) => ({ studentId: s.id, marksObtained: Number(marks[s.id] ?? "") }))
        .filter((r) => Number.isFinite(r.marksObtained));
      const response = await apiFetch(`/api/v1/schools/${schoolId}/exams/${entryExamId}/marks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examSubjectId: entrySubjectId, sectionId: entrySectionId, records }),
      });
      const body = (await response.json()) as { data: { entered: number } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Save failed.");
      }
      setEntryNotice(`Saved ${body.data.entered} mark(s) — ranks recalculated below.`);
      setExamId(entryExamId);
      await loadResults(entryExamId, top);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setEntering(false);
    }
  }

  function applyTop(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (examId) {
      void loadResults(examId, top);
    }
  }

  const gradeTone = (grade: string): string =>
    grade.startsWith("A") ? colors.success : grade.startsWith("B") ? colors.primary : grade.startsWith("C") || grade === "D" ? colors.warning : colors.danger;

  const gradeTint = (grade: string): string =>
    grade.startsWith("A") ? colors.successTint : grade.startsWith("B") ? colors.primaryGhost : grade.startsWith("C") || grade === "D" ? colors.warningTint : colors.dangerTint;

  const titleStyle: React.CSSProperties = { ...h1Style, display: "flex", alignItems: "center", gap: 8 };

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...titleStyle, margin: "0 0 12px" }}>
          <Award size={22} aria-hidden="true" color={colors.primary} /> Exam Results
        </h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...titleStyle, margin: "0 0 12px" }}>
          <Award size={22} aria-hidden="true" color={colors.primary} /> Exam Results
        </h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to view results.</p>
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
        <Award size={22} aria-hidden="true" color={colors.primary} /> Exam Results{examName ? ` — ${examName}` : ""}
      </h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Ranked class board — ranks always reflect the whole class.
      </p>
      <div className="sf-row-wrap" style={{ marginBottom: 12 }}>
        <label style={{ ...labelStyle, flex: 1, minWidth: 220 }}>
          Exam
          <select className="sf-select" value={examId} onChange={pickExam} aria-label="Exam">
            <option value="">— pick an exam —</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <form onSubmit={applyTop} className="sf-row-wrap" style={{ alignItems: "flex-end" }}>
          <label style={labelStyle}>
            Top K
            <input
              className="sf-input"
              style={{ width: 120 }}
              value={top}
              onChange={(e) => setTop(e.target.value)}
              placeholder="all"
              inputMode="numeric"
              aria-label="Top K"
            />
          </label>
          <button type="submit" style={primaryBtn}>
            Apply
          </button>
        </form>
      </div>
      {canEnter ? (
        <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
          <h2 style={h2Style}>Enter marks (class teacher)</h2>
          <form onSubmit={saveMarks} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="sf-row-wrap">
              <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
                Exam
                <select
                  className="sf-select"
                  value={entryExamId}
                  onChange={(e) => {
                    setEntryExamId(e.target.value);
                    setEntrySubjectId("");
                  }}
                  required
                  aria-label="Entry exam"
                >
                  <option value="">— pick an exam —</option>
                  {exams.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
                Subject
                <select
                  className="sf-select"
                  value={entrySubjectId}
                  onChange={(e) => setEntrySubjectId(e.target.value)}
                  required
                  aria-label="Entry subject"
                >
                  <option value="">— pick a subject —</option>
                  {entrySubjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subject.name} (max {s.maxMarks})
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
                Section
                <select
                  className="sf-select"
                  value={entrySectionId}
                  onChange={(e) => {
                    setEntrySectionId(e.target.value);
                    if (e.target.value) {
                      void loadEntryRoster(e.target.value);
                    } else {
                      setRoster([]);
                    }
                  }}
                  required
                  aria-label="Entry section"
                >
                  <option value="">— pick a section —</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.className} {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {roster.length > 0 ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                {roster.map((s) => (
                  <li key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}>
                    <span style={{ flex: 1, color: colors.ink, fontWeight: 500 }}>{s.name}</span>
                    <input
                      className="sf-input"
                      style={{ width: 110, padding: "8px 10px" }}
                      value={marks[s.id] ?? ""}
                      onChange={(e) => setMarks((prev) => ({ ...prev, [s.id]: e.target.value }))}
                      placeholder="Marks"
                      inputMode="decimal"
                      aria-label={`Marks for ${s.name}`}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              type="submit"
              disabled={entering}
              style={{ ...primaryBtn, alignSelf: "flex-start", opacity: entering ? 0.6 : 1 }}
            >
              {entering ? "Saving…" : "Save marks"}
            </button>
          </form>
          {entryNotice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{entryNotice}</p> : null}
        </section>
      ) : null}
      <DataTable<ResultRow>
        columns={[
          {
            key: "rank",
            label: "Rank",
            render: (r) => (
              <span
                style={{
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  color: colors.primary,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {`#${r.rank}`}
              </span>
            ),
          },
          { key: "name", label: "Student", render: (r) => r.name },
          {
            key: "total",
            label: "Total",
            render: (r) => (
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: colors.ink }}>
                {`${r.total} / ${r.max}`}
              </span>
            ),
          },
          {
            key: "percent",
            label: "%",
            render: (r) => (
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: colors.inkSoft }}>
                {`${r.percent}%`}
              </span>
            ),
          },
          {
            key: "grade",
            label: "Grade",
            render: (r) => <span style={pill(gradeTone(r.grade), gradeTint(r.grade))}>{r.grade}</span>,
          },
        ]}
        rows={rows}
        rowKey={(r) => r.studentId}
        sort="rank"
        order="asc"
        onSort={() => undefined}
        page={1}
        totalPages={1}
        total={rows.length}
        onPage={() => undefined}
        loading={loading}
        showPager={false}
        emptyMessage="No results for this exam yet."
      />
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
