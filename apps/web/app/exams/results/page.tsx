"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Award } from "lucide-react";
import { DataTable } from "../../../components/ui/data-table";
import { isFailure } from "../../../lib/api";

interface ExamOption {
  id: string;
  name: string;
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
// always reflect the whole class. Grade pills follow §8.2.
export default function ExamResultsPage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [examId, setExamId] = useState("");
  const [top, setTop] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [examName, setExamName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const auth = { Authorization: `Bearer ${token}` };

  const loadExams = useCallback(async () => {
    const response = await fetch(`${api}/api/v1/schools/${schoolId}/exams`, { headers: auth });
    const body = (await response.json()) as { data: { exams: ExamOption[] } } | ApiError;
    if (isFailure(response, body)) {
      throw new Error(body.error?.message ?? "Failed to load exams.");
    }
    return body.data.exams;
  }, [api, schoolId, token]);

  const loadResults = useCallback(
    async (nextExam: string, nextTop: string) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (nextTop) {
          params.set("top", nextTop);
        }
        const query = params.toString();
        const response = await fetch(
          `${api}/api/v1/schools/${schoolId}/exams/${nextExam}/results${query ? `?${query}` : ""}`,
          { headers: auth },
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
    [api, schoolId, token],
  );

  async function connect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    try {
      const list = await loadExams();
      setExams(list);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  function pickExam(event: React.ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value;
    setExamId(next);
    if (next) {
      void loadResults(next, top);
    }
  }

  function applyTop(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (examId) {
      void loadResults(examId, top);
    }
  }

  const gradeColor = (grade: string): string =>
    grade.startsWith("A") ? "#059669" : grade.startsWith("B") ? "#2563EB" : grade.startsWith("C") ? "#D97706" : grade === "D" ? "#D97706" : "#DC2626";

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

  return (
    <main style={page}>
      <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
        <Award size={22} aria-hidden="true" color="#2563EB" /> Exam Results{examName ? ` — ${examName}` : ""}
      </h1>
      <p style={{ color: "#64748B", margin: "0 0 20px", fontSize: 14 }}>
        Ranked class board — ranks always reflect the whole class.
      </p>
      {!connected ? (
        <form
          onSubmit={connect}
          style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 20 }}
        >
          <label>
            School ID
            <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
          </label>
          <label>
            Bearer token (dev only — login screen replaces this)
            <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <button type="submit" style={primaryBtn}>
            Connect
          </button>
        </form>
      ) : (
        <>
          <div className="sf-row-wrap" style={{ marginBottom: 12 }}>
            <label style={{ flex: 1, minWidth: 220 }}>
              Exam
              <select style={input} value={examId} onChange={pickExam} aria-label="Exam">
                <option value="">— pick an exam —</option>
                {exams.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <form onSubmit={applyTop} className="sf-row-wrap" style={{ alignItems: "flex-end" }}>
              <label>
                Top K
                <input
                  style={{ ...input, marginBottom: 12 }}
                  value={top}
                  onChange={(e) => setTop(e.target.value)}
                  placeholder="all"
                  inputMode="numeric"
                  aria-label="Top K"
                />
              </label>
              <button type="submit" style={{ ...primaryBtn, marginBottom: 12 }}>
                Apply
              </button>
            </form>
          </div>
          <DataTable<ResultRow>
            columns={[
              { key: "rank", label: "Rank", render: (r) => `#${r.rank}` },
              { key: "name", label: "Student", render: (r) => r.name },
              { key: "total", label: "Total", render: (r) => `${r.total} / ${r.max}` },
              { key: "percent", label: "%", render: (r) => `${r.percent}%` },
              {
                key: "grade",
                label: "Grade",
                render: (r) => (
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 10px",
                      borderRadius: 999,
                      border: `1px solid ${gradeColor(r.grade)}`,
                      color: gradeColor(r.grade),
                      fontWeight: 700,
                    }}
                  >
                    {r.grade}
                  </span>
                ),
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
        </>
      )}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
