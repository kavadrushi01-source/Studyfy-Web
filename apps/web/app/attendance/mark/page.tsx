"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, RefreshCw, Save, Users } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn, secondaryBtn } from "@/lib/theme";

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
    async (nextSection: string, day: string) => {
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
        // Hydrate saved statuses for this day (best-effort): a reopened day
        // must show what was actually saved - silent PRESENT defaults would
        // make a careless re-save flip real absences to present.
        try {
          const savedResponse = await apiFetch(
            `/api/v1/schools/${schoolId}/attendance?date=${encodeURIComponent(day)}&sectionId=${encodeURIComponent(nextSection)}`,
          );
          const savedBody = (await savedResponse.json()) as
            | { data: { records: { studentId: string; status: string }[] } }
            | ApiError;
          if (!isFailure(savedResponse, savedBody)) {
            const merged: Record<string, Mark> = { ...initial };
            for (const record of savedBody.data.records) {
              if (record.status === "PRESENT" || record.status === "ABSENT") {
                merged[record.studentId] = record.status;
              }
            }
            setMarks(merged);
          }
        } catch {
          // Hydration is best-effort - the PRESENT defaults already stand.
        }
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
      void loadRoster(next, date);
    }
  }

  function pickDate(event: React.ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value;
    setDate(next);
    if (sectionId) {
      // Re-hydrate against the newly chosen day - saved statuses there win
      // over the local defaults (and any stale edits for the old day).
      void loadRoster(sectionId, next);
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
  const togglePill = (active: boolean, color: string, tint: string): React.CSSProperties => ({
    ...pill(active ? "#fff" : color, active ? color : tint),
    padding: "5px 14px",
    fontSize: 13,
    fontFamily: "inherit",
    cursor: "pointer",
    border: `1px solid ${active ? color : colors.line}`,
    transition:
      "background 180ms cubic-bezier(.22,1,.36,1), color 180ms cubic-bezier(.22,1,.36,1), border-color 180ms cubic-bezier(.22,1,.36,1)",
  });
  const saveDisabled = saving || loading || rows.length === 0;

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Mark Attendance</h1>
        <SkeletonBlocks rows={6} height={48} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Mark Attendance</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to mark attendance.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Mark Attendance</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        White-card roster — green Present, red Absent, one Save.{" "}
        <Link href="/attendance/reports" style={{ color: colors.primary, fontWeight: 600 }}>
          Monthly &amp; term reports →
        </Link>
      </p>
      <div className="sf-row-wrap" style={{ marginBottom: 12 }}>
        <label style={{ ...labelStyle, flex: 1, minWidth: 220 }}>
          Section
          <select className="sf-select" value={sectionId} onChange={pickSection} aria-label="Section">
            <option value="">— pick a section —</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.class.name} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Date
          <input className="sf-input" type="date" value={date} onChange={pickDate} required />
        </label>
      </div>
      {sectionId ? (
        <>
          <div className="sf-row-wrap" style={{ marginBottom: 12 }}>
            <button type="button" onClick={markAllPresent} style={secondaryBtn}>
              <Users size={14} aria-hidden="true" /> Mark all present
            </button>
            <button
              type="button"
              onClick={() => void loadRoster(sectionId, date)}
              disabled={loading}
              style={{ ...secondaryBtn, opacity: loading ? 0.6 : 1 }}
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
            <div className="sf-card" style={{ overflow: "hidden" }}>
              <div className="sf-table-scroll">
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Student</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.id}
                        style={{ transition: "background 140ms cubic-bezier(.22,1,.36,1)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#F8FAFD";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <td style={td}>{row.user.name}</td>
                        <td style={td}>
                          <div style={{ display: "flex", gap: 8 }} role="group" aria-label={`Mark ${row.user.name}`}>
                            <button
                              type="button"
                              aria-pressed={marks[row.id] === "PRESENT"}
                              style={togglePill(marks[row.id] === "PRESENT", colors.success, colors.successTint)}
                              onClick={() => toggle(row.id)}
                            >
                              Present
                            </button>
                            <button
                              type="button"
                              aria-pressed={marks[row.id] === "ABSENT"}
                              style={togglePill(marks[row.id] === "ABSENT", colors.danger, colors.dangerTint)}
                              onClick={() => toggle(row.id)}
                            >
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
      {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
