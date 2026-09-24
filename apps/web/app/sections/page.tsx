"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Inbox } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";

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
// Role-agnostic staff page: NOT wrapped in Shell (Shell requires a role
// prop — forcing one would badge the wrong role), so this page carries the
// light-canvas background, Inter font, and 1120/padding-28 rhythm directly.
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
      if (isFailure(response, body)) {
        setError(body.error?.message ?? `Request failed (${response.status}).`);
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
      if (isFailure(response, body)) {
        setError(body.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setNotice(teacherEmail ? `Assigned ${teacherEmail}.` : "Assignment cleared.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
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
  const secondaryBtn = {
    background: "#fff",
    color: "#0F172A",
    border: "1px solid #CBD5E1",
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

  const empty = connected && !loading && rows.length === 0;

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
      <h1 style={{ color: "#0F172A" }}>Classes &amp; Sections</h1>
      {!connected ? (
        <form onSubmit={connect} style={{ ...card, maxWidth: 640 }}>
          <label>
            School ID
            <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
          </label>
          <label>
            Admin bearer token (dev only — login screen replaces this)
            <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <button type="submit" style={primaryBtn}>
            Connect
          </button>
        </form>
      ) : loading ? (
        <SkeletonBlocks rows={4} />
      ) : empty ? (
        <EmptyState
          icon={<Inbox size={22} aria-hidden="true" />}
          title="No sections yet"
          detail="No sections found for this school."
        />
      ) : (
        <div style={{ ...card, padding: 0, overflow: "hidden" }}>
          <div className="sf-table-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      color: "#2563EB",
                      fontSize: 13,
                      borderBottom: "1px solid #E2E8F0",
                    }}
                  >
                    Class · Sec
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      color: "#2563EB",
                      fontSize: 13,
                      borderBottom: "1px solid #E2E8F0",
                    }}
                  >
                    Class teacher
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      color: "#2563EB",
                      fontSize: 13,
                      borderBottom: "1px solid #E2E8F0",
                    }}
                  >
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
                      <div className="sf-row-wrap">
                        <input
                          style={{ flex: 1, minWidth: 160, padding: 6 }}
                          placeholder="teacher@school…"
                          value={emails[row.id] ?? ""}
                          onChange={(e) => setEmails((prev) => ({ ...prev, [row.id]: e.target.value }))}
                          aria-label={`Teacher email for ${row.class.name} ${row.name}`}
                        />
                        <button type="button" style={primaryBtn} onClick={() => void assign(row.id, emails[row.id] ?? null)}>
                          Assign
                        </button>
                        <button type="button" style={secondaryBtn} onClick={() => void assign(row.id, null)}>
                          Clear
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
