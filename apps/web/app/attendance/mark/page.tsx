"use client";

import { useCallback, useState, type FormEvent } from "react";

interface SectionOption {
  id: string;
  name: string;
  class: { name: string };
}

interface RosterRow {
  id: string;
  user: { name: string };
}

type Mark = "PRESENT" | "ABSENT";

interface ApiError {
  error: { code: string; message: string };
}

// Attendance marking (Phase 1 Chunk 2, spec §7 #2). Board language (§8.2):
// white card roster, green Present / red Absent pills, one primary Save.
// Everything is skeleton-while-loading (RULES.md §5 — never spinners).
// Authorization lives API-side (class teacher or Admin); a 403 here means
// "not your section" and is shown as-is.
export default function MarkAttendancePage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const auth = { Authorization: `Bearer ${token}` };

  const loadSections = useCallback(async () => {
    const response = await fetch(`${api}/api/v1/schools/${schoolId}/sections`, { headers: auth });
    const body = (await response.json()) as { data: { sections: SectionOption[] } } | ApiError;
    if (!response.ok || "error" in body) {
      throw new Error("error" in body ? (body.error?.message ?? "Failed to load sections.") : "Failed to load sections.");
    }
    return body.data.sections;
  }, [api, schoolId, token]);

  const loadRoster = useCallback(
    async (nextSection: string) => {
      setLoading(true);
      setError("");
      setNotice("");
      try {
        const params = new URLSearchParams({ sectionId: nextSection, pageSize: "100", sort: "name", order: "asc" });
        const response = await fetch(`${api}/api/v1/schools/${schoolId}/students?${params}`, { headers: auth });
        const body = (await response.json()) as { data: { students: RosterRow[] } } | ApiError;
        if (!response.ok || "error" in body) {
          throw new Error("error" in body ? (body.error?.message ?? "Failed to load roster.") : "Failed to load roster.");
        }
        setRows(body.data.students);
        const initial: Record<string, Mark> = {};
        for (const row of body.data.students) {
          initial[row.id] = "PRESENT";
        }
        setMarks(initial);
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
      const list = await loadSections();
      setSections(list);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  function pickSection(event: React.ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value;
    setSectionId(next);
    if (next) {
      void loadRoster(next);
    }
  }

  function markAllPresent(): void {
    const initial: Record<string, Mark> = {};
    for (const row of rows) {
      initial[row.id] = "PRESENT";
    }
    setMarks(initial);
  }

  function toggle(id: string): void {
    setMarks((prev) => ({ ...prev, [id]: prev[id] === "PRESENT" ? "ABSENT" : "PRESENT" }));
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const records = rows.map((row) => ({ studentId: row.id, status: marks[row.id] ?? "PRESENT" }));
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ sectionId, date, records }),
      });
      const body = (await response.json()) as { data: { marked: number } } | ApiError;
      if (!response.ok || "error" in body) {
        throw new Error("error" in body ? (body.error?.message ?? "Save failed.") : "Save failed.");
      }
      setNotice(`Saved attendance for ${body.data.marked} students on ${date}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSaving(false);
    }
  }

  const input = { display: "block", width: "100%", margin: "4px 0 12px", padding: 8 } as const;
  const pill = (active: boolean, color: string): React.CSSProperties => ({
    padding: "4px 12px",
    borderRadius: 999,
    border: `1px solid ${color}`,
    background: active ? color : "#fff",
    color: active ? "#fff" : color,
    cursor: "pointer",
    fontSize: 13,
  });

  return (
    <main style={{ maxWidth: 900, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Mark Attendance</h1>
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
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <label style={{ flex: 1 }}>
              Section
              <select style={input} value={sectionId} onChange={pickSection} aria-label="Section">
                <option value="">— pick a section —</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.class.name} · {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input style={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
          </div>
          {sectionId ? (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button type="button" onClick={markAllPresent}>
                  Mark all present
                </button>
                <button type="button" onClick={() => void loadRoster(sectionId)} disabled={loading}>
                  Reload
                </button>
              </div>
              <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "10px 12px", color: "#2563EB", fontSize: 13, borderBottom: "1px solid #E2E8F0" }}>
                        Student
                      </th>
                      <th style={{ textAlign: "left", padding: "10px 12px", color: "#2563EB", fontSize: 13, borderBottom: "1px solid #E2E8F0" }}>
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 6 }, (_, i) => (
                          <tr key={`skeleton-${i}`}>
                            <td style={{ padding: "10px 12px", borderBottom: "1px solid #F1F5F9" }}>
                              <div style={{ height: 14, borderRadius: 6, background: "#F1F5F9" }} />
                            </td>
                            <td style={{ padding: "10px 12px", borderBottom: "1px solid #F1F5F9" }}>
                              <div style={{ height: 14, borderRadius: 6, background: "#F1F5F9" }} />
                            </td>
                          </tr>
                        ))
                      : rows.map((row) => (
                          <tr key={row.id}>
                            <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9" }}>
                              {row.user.name}
                            </td>
                            <td style={{ padding: "10px 12px", borderBottom: "1px solid #F1F5F9" }}>
                              <div style={{ display: "flex", gap: 8 }} role="group" aria-label={`Mark ${row.user.name}`}>
                                <button type="button" style={pill(marks[row.id] === "PRESENT", "#059669")} onClick={() => toggle(row.id)}>
                                  Present
                                </button>
                                <button type="button" style={pill(marks[row.id] === "ABSENT", "#DC2626")} onClick={() => toggle(row.id)}>
                                  Absent
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={() => void save()} disabled={saving || loading || rows.length === 0} style={{ marginTop: 12 }}>
                {saving ? "Saving…" : `Save attendance (${rows.length})`}
              </button>
            </>
          ) : null}
        </>
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
