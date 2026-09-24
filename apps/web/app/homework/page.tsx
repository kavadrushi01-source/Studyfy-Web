"use client";

import { useCallback, useState, type FormEvent } from "react";
import { isFailure } from "../../lib/api";

interface BoardItem {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  subject: { name: string };
  section: { name: string; className: string };
  teacher: { name: string };
  mySubmissions: { studentId: string; status: string }[];
  counts: { total: number; submitted: number; graded: number } | null;
}

interface ApiError {
  error: { code: string; message: string };
}

// Homework board (§7 Phase 1 #6). One call shapes rows per role: students
// split pending vs graded from mySubmissions, teachers see authored rows
// with needs-grading counts, admins everything. Empty states are real
// cards per §8.5 — never a blank page, never a spinner.
export default function HomeworkPage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [items, setItems] = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/homework`, { headers: auth });
      const body = (await response.json()) as { data: { homework: BoardItem[] } } | ApiError;
      if (isFailure(response, body)) {
                setError(body.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setItems(body.data.homework);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [api, schoolId, token]);

  function connect(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void load();
  }

  const input = { display: "block", width: "100%", margin: "4px 0 12px", padding: 8 } as const;
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

  const empty = !loading && connected && items.length === 0;

  return (
    <main style={{ maxWidth: 900, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Homework</h1>
      {!connected ? (
        <form onSubmit={connect}>
          <label>
            School ID
            <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
          </label>
          <label>
            Bearer token (dev only — login screen replaces this)
            <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <button type="submit">Connect</button>
        </form>
      ) : (
        <>
          <button type="button" onClick={() => void load()} disabled={loading} style={{ marginBottom: 12 }}>
            Reload
          </button>
          {loading ? (
            <div>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ height: 96, borderRadius: 14, background: "#F1F5F9", marginBottom: 12 }} />
              ))}
            </div>
          ) : empty ? (
            <div style={{ ...card, textAlign: "center", padding: 32 }}>
              <h2 style={{ marginTop: 0 }}>Nothing pending</h2>
              <p style={{ color: "#64748B" }}>No homework assigned here yet — you are all caught up.</p>
            </div>
          ) : (
            items.map((item) => {
              const status = statusOf(item);
              return (
                <article key={item.id} style={card}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <h3 style={{ margin: 0, flex: 1 }}>{item.title}</h3>
                    <span style={pill(status.color)}>{status.label}</span>
                  </div>
                  <p style={{ color: "#334155" }}>{item.description}</p>
                  <small style={{ color: "#64748B" }}>
                    {item.subject.name} · {item.section.className} {item.section.name} · {item.teacher.name} · due{" "}
                    {item.dueDate}
                  </small>
                </article>
              );
            })
          )}
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
