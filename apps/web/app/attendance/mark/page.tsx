"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, RefreshCw, Save, Users } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";

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
// "not your section" and is shown as-is. Identity comes from the shared
// session (useAuth).
export default function MarkAttendancePage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSections = useCallback(async () => {
    if (!schoolId) {
      throw new Error("Please sign in to mark attendance.");
    }
    const response = await apiFetch(`/api/v1/schools/${schoolId}/sections`);
    const body = (await response.json()) as { data: { sections: SectionOption[] } } | ApiError;
    if (isFailure(response, body)) {
      throw new Error(body.error?.message ?? "Failed to load sections.");
    }
    return body.data.sections;
  }, [schoolId, apiFetch]);

  const loadRoster = useCallback(
    async (nextSection: string) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      setNotice("");
      try {
        const params = new URLSearchParams({ sectionId: nextSection, pageSize: "100", sort: "name", order: "asc" });
        const response = await apiFetch(`/api/v1/schools/${schoolId}/students?${params}`);
        const body = (await response.json()) as { data: { students: RosterRow[] } } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load roster.");
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
    [schoolId, apiFetch],
  );

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void (async () => {
      setError("");
      try {
        setSections(await loadSections());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      }
    })();
  }, [ready, token, schoolId, loadSections]);

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
    if (!schoolId) {
      setError("Please sign in to save attendance.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const records = rows.map((row) => ({ studentId: row.id, status: marks[row.id] ?? "PRESENT" }));
      const response = await apiFetch(`/api/v1/schools/${schoolId}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId, date, records }),
      });
      const body = (await response.json()) as { data: { marked: number } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Save failed.");
      }
      setNotice(`Saved attendance for ${body.data.marked} students on ${fmtDay(date)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSaving(false);
    }
  }

  function fmtDay(iso: string): string {
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
    overflow: "hidden",
  };
  const pill = (active: boolean, color: string): React.CSSProperties => ({
    padding: "4px 12px",
    borderRadius: 999,
    border: `1px solid ${color}`,
    background: active ? color : "#fff",
    color: active ? "#fff" : color,
    cursor: "pointer",
    fontSize: 13,
  });
  const saveDisabled = saving || loading || rows.length === 0;

  if (!ready) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A" }}>Mark Attendance</h1>
        <SkeletonBlocks rows={6} height={48} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={page}>
        <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A" }}>Mark Attendance</h1>
        <div style={{ ...card, padding: 20 }}>
          <p style={{ color: "#334155" }}>Please sign in to mark attendance.</p>
          <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={page}>
      <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A" }}>Mark Attendance</h1>
      <p style={{ color: "#64748B", margin: "0 0 20px", fontSize: 14 }}>
        White-card roster — green Present, red Absent, one Save.
      </p>
      <div className="sf-row-wrap" style={{ marginBottom: 12 }}>
        <label style={{ flex: 1, minWidth: 220 }}>
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
          <div className="sf-row-wrap" style={{ marginBottom: 12 }}>
            <button type="button" onClick={markAllPresent} style={quietBtn}>
              <Users size={14} aria-hidden="true" /> Mark all present
            </button>
            <button
              type="button"
              onClick={() => void loadRoster(sectionId)}
              disabled={loading}
              style={{ ...quietBtn, opacity: loading ? 0.6 : 1 }}
            >
              <RefreshCw size={14} aria-hidden="true" /> Reload
            </button>
          </div>
          {loading ? (
            <SkeletonBlocks rows={6} height={48} />
          ) : rows.length === 0 ? (
            <div style={{ display: "grid", gap: 12 }}>
              <EmptyState
                icon={<ClipboardList size={22} aria-hidden="true" />}
                title="No students in this section"
                detail="Nothing to mark here yet — pick another section or check enrolments. Save stays disabled until a roster loads."
              />
            </div>
          ) : (
            <div style={card}>
              <div className="sf-table-scroll">
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
                    {rows.map((row) => (
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
            </div>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saveDisabled}
            style={{ ...primaryBtn, marginTop: 12, opacity: saveDisabled ? 0.6 : 1, cursor: saveDisabled ? "not-allowed" : "pointer" }}
          >
            <Save size={14} aria-hidden="true" /> {saving ? "Saving…" : `Save attendance (${rows.length})`}
          </button>
        </>
      ) : null}
      {notice ? <p style={{ color: "#059669" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
