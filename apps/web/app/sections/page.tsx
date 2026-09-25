"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";

interface SectionRow {
  id: string;
  name: string;
  class: { name: string };
  classTeacher: { user: { name: string; email: string } } | null;
}

interface ApiError {
  error: { code: string; message: string };
}

// Sections screen (Phase 1 Chunk 1). Lists every section with its current
// class teacher; an admin assigns by teacher email (or clears).
// The teacher must belong to this school — anything else is a 404 from the
// API, surfaced as-is. Identity comes from the shared session (useAuth).
// Role-agnostic staff page: NOT wrapped in Shell (Shell requires a role
// prop — forcing one would badge the wrong role), so this page carries the
// light-canvas background, Inter font, and 1120/padding-28 rhythm directly.
export default function SectionsPage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [rows, setRows] = useState<SectionRow[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/sections`);
      const body = (await response.json()) as { data: { sections: SectionRow[] } } | ApiError;
      if (isFailure(response, body)) {
        setError(body.error?.message ?? `Request failed (${response.status}).`);
        return;
      }
      setRows(body.data.sections);
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

  async function assign(sectionId: string, teacherEmail: string | null): Promise<void> {
    if (!schoolId) {
      setError("Please sign in to assign a teacher.");
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/sections/${sectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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

  const frame = {
    maxWidth: 1120,
    margin: "0 auto",
    padding: 28,
    fontFamily: "Inter, system-ui, sans-serif",
    background: "#F8FAFC",
    minHeight: "100vh",
  } as const;

  if (!ready) {
    return (
      <main style={frame}>
        <h1 style={{ color: "#0F172A" }}>Classes &amp; Sections</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={frame}>
        <h1 style={{ color: "#0F172A" }}>Classes &amp; Sections</h1>
        <div style={{ ...card, maxWidth: 640 }}>
          <p style={{ color: "#334155" }}>Please sign in to view sections.</p>
          <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  const empty = !loading && rows.length === 0;

  return (
    <main style={frame}>
      <h1 style={{ color: "#0F172A" }}>Classes &amp; Sections</h1>
      {loading ? (
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
