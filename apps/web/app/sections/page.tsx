"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, School } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { SignInGate, actionSignInMessage } from "../../components/ui/sign-in-gate";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, iconTile, pageFrame, pill } from "@/lib/theme";

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
      setError(actionSignInMessage("Please sign in to assign a teacher.", token, schoolId));
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

  const pageH1 = { ...h1Style, marginBottom: 14 };
  const errorAlert = {
    margin: "14px 0 0",
    padding: "10px 14px",
    borderRadius: 12,
    background: colors.dangerTint,
    border: "1px solid rgba(220,38,38,.28)",
    color: colors.danger,
    fontSize: 14,
  };
  const successAlert = {
    margin: "14px 0 0",
    padding: "10px 14px",
    borderRadius: 12,
    background: colors.successTint,
    border: "1px solid rgba(5,150,105,.28)",
    color: colors.success,
    fontSize: 14,
  };
  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "12px 14px",
    color: colors.muted,
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    borderBottom: `1px solid ${colors.line}`,
    background: "linear-gradient(180deg, #FAFCFF 0%, #F5F8FD 100%)",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "12px 14px",
    fontSize: 14,
    color: colors.inkSoft,
    borderBottom: `1px solid ${colors.lineSoft}`,
  };

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={pageH1}>Classes &amp; Sections</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={pageH1}>Classes &amp; Sections</h1>
        <SignInGate prompt="Please sign in to view sections." />
      </main>
    );
  }

  const empty = !loading && rows.length === 0;

  return (
    <main style={pageFrame}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={iconTile(colors.primary, colors.primaryGhost, 40)}>
          <School size={20} aria-hidden="true" />
        </span>
        <h1 style={h1Style}>Classes &amp; Sections</h1>
      </div>
      {loading ? (
        <SkeletonBlocks rows={4} />
      ) : empty ? (
        <EmptyState
          icon={<Inbox size={22} aria-hidden="true" />}
          title="No sections yet"
          detail="No sections found for this school."
        />
      ) : (
        <div className="sf-card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="sf-table-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Class · Sec</th>
                  <th style={th}>Class teacher</th>
                  <th style={th}>Assign by email</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={td}>
                      <span style={pill(colors.primary, colors.primaryGhost)}>
                        {row.class.name} · {row.name}
                      </span>
                    </td>
                    <td style={td}>
                      {row.classTeacher
                        ? `${row.classTeacher.user.name} (${row.classTeacher.user.email})`
                        : "—"}
                    </td>
                    <td style={td}>
                      <div className="sf-row-wrap">
                        <input
                          className="sf-input"
                          style={{ flex: 1, minWidth: 160 }}
                          placeholder="teacher@school…"
                          value={emails[row.id] ?? ""}
                          onChange={(e) => setEmails((prev) => ({ ...prev, [row.id]: e.target.value }))}
                          aria-label={`Teacher email for ${row.class.name} ${row.name}`}
                        />
                        <button
                          type="button"
                          className="sf-btn sf-btn-primary"
                          onClick={() => void assign(row.id, emails[row.id] ?? null)}
                        >
                          Assign
                        </button>
                        <button
                          type="button"
                          className="sf-btn sf-btn-secondary"
                          onClick={() => void assign(row.id, null)}
                        >
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
      {notice ? <p style={successAlert}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={errorAlert}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
