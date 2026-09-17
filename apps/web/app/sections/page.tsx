"use client";

import { useCallback, useState, type FormEvent } from "react";

interface SectionRow {
  id: string;
  name: string;
  class: { name: string };
  classTeacher: { user: { name: string; email: string } } | null;
}

interface ApiError {
  error: { code: string; message: string };
}

// Pre-dashboard sections screen (Phase 1 Chunk 1). Lists every section with
// its current class teacher; an admin assigns by teacher email (or clears).
// The teacher must belong to this school — anything else is a 404 from the
// API, surfaced as-is. Same token-paste dev workflow as the other screens
// until the login screen lands.
export default function SectionsPage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [rows, setRows] = useState<SectionRow[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/sections`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json()) as { data: { sections: SectionRow[] } } | ApiError;
      if (!response.ok || "error" in body) {
        const message =
          "error" in body ? (body.error?.message ?? `Request failed (${response.status}).`) : `Request failed (${response.status}).`;
        setError(message);
        return;
      }
      setRows(body.data.sections);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, token]);

  function connect(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void load();
  }

  async function assign(sectionId: string, teacherEmail: string | null): Promise<void> {
    setError("");
    setNotice("");
    try {
      const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const response = await fetch(`${api}/api/v1/schools/${schoolId}/sections/${sectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teacherEmail }),
      });
      const body = (await response.json()) as { data: { section: unknown } } | ApiError;
      if (!response.ok || "error" in body) {
        const message =
          "error" in body ? (body.error?.message ?? `Request failed (${response.status}).`) : `Request failed (${response.status}).`;
        setError(message);
        return;
      }
      setNotice(teacherEmail ? `Assigned ${teacherEmail}.` : "Assignment cleared.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  const input = { display: "block", width: "100%", margin: "4px 0 12px", padding: 8 } as const;

  return (
    <main style={{ maxWidth: 900, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Classes &amp; Sections</h1>
      {!connected ? (
        <form onSubmit={connect}>
          <label>
            School ID
            <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
          </label>
          <label>
            Admin bearer token (dev only — login screen replaces this)
            <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <button type="submit">Connect</button>
        </form>
      ) : (
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 12px", color: "#2563EB", fontSize: 13, borderBottom: "1px solid #E2E8F0" }}>
                  Class · Sec
                </th>
                <th style={{ textAlign: "left", padding: "10px 12px", color: "#2563EB", fontSize: 13, borderBottom: "1px solid #E2E8F0" }}>
                  Class teacher
                </th>
                <th style={{ textAlign: "left", padding: "10px 12px", color: "#2563EB", fontSize: 13, borderBottom: "1px solid #E2E8F0" }}>
                  Assign by email
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9" }}>
                    {row.class.name} · {row.name}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9" }}>
                    {row.classTeacher ? `${row.classTeacher.user.name} (${row.classTeacher.user.email})` : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9" }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        style={{ flex: 1, padding: 6 }}
                        placeholder="teacher@school…"
                        value={emails[row.id] ?? ""}
                        onChange={(e) => setEmails((prev) => ({ ...prev, [row.id]: e.target.value }))}
                        aria-label={`Teacher email for ${row.class.name} ${row.name}`}
                      />
                      <button type="button" onClick={() => void assign(row.id, emails[row.id] ?? null)}>
                        Assign
                      </button>
                      <button type="button" onClick={() => void assign(row.id, null)}>
                        Clear
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading ? <p>Loading…</p> : null}
      {notice ? <p style={{ color: "#059669" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
