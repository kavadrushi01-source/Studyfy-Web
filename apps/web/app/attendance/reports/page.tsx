"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, primaryBtn } from "@/lib/theme";

interface SectionOption {
  id: string;
  name: string;
  class: { name: string };
}

interface SummaryRow {
  studentId: string;
  name: string;
  total: number;
  present: number;
  percent: number;
}

interface ApiError {
  error: { code: string; message: string };
}

// Attendance reports (§7 Phase 1 #2, Chunk 2 close-out): monthly and custom
// term ranges over the tested GET /attendance/summary endpoint. Staff get a
// section filter; pupils/parents are narrowed to their own rows API-side
// (self-scope pins), so they only ever see themselves here.
export default function AttendanceReportsPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canFilter = user?.role === "SCHOOL_ADMIN" || user?.role === "TEACHER" || user?.role === "ACCOUNTANT";
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (opts: { section: string; month: string; from: string; to: string }) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (opts.section) {
          params.set("sectionId", opts.section);
        }
        if (opts.from && opts.to) {
          params.set("from", opts.from);
          params.set("to", opts.to);
        } else {
          params.set("month", opts.month);
        }
        const response = await apiFetch(`/api/v1/schools/${schoolId}/attendance/summary?${params}`);
        const body = (await response.json()) as {
          data: { range: { from: string; to: string }; summary: SummaryRow[] };
        } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load the report.");
        }
        setRows(body.data.summary);
        setRange(body.data.range);
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
    void load({ section: "", month: new Date().toISOString().slice(0, 7), from: "", to: "" });
    if (canFilter) {
      void (async () => {
        try {
          const response = await apiFetch(`/api/v1/schools/${schoolId}/sections`);
          const body = (await response.json()) as { data: { sections: SectionOption[] } } | ApiError;
          if (!isFailure(response, body)) {
            setSections(body.data.sections);
          }
        } catch {
          // Sections are a filter nicety - the unfiltered report stands alone.
        }
      })();
    }
  }, [ready, token, schoolId, apiFetch, canFilter, load]);

  function pickSection(event: React.ChangeEvent<HTMLSelectElement>): void {
    const next = event.target.value;
    setSectionId(next);
    void load({ section: next, month, from, to });
  }

  function show(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void load({ section: sectionId, month, from, to });
  }

  function percentTone(percent: number): string {
    if (percent >= 90) {
      return colors.success;
    }
    if (percent >= 75) {
      return colors.primary;
    }
    if (percent >= 50) {
      return colors.warning;
    }
    return colors.danger;
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

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Attendance Reports</h1>
        <SkeletonBlocks rows={6} height={48} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Attendance Reports</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to view attendance reports.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Attendance Reports</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Monthly percentages and custom term ranges — <Link href="/attendance/mark" style={{ color: colors.primary, fontWeight: 600 }}>mark attendance</Link> first, then read it here.
      </p>
      <form onSubmit={show} className="sf-row-wrap" style={{ marginBottom: 12 }}>
        {canFilter ? (
          <label style={{ ...labelStyle, flex: 1, minWidth: 220 }}>
            Section
            <select className="sf-select" value={sectionId} onChange={pickSection} aria-label="Section">
              <option value="">— all sections —</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.class.name} · {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label style={labelStyle}>
          Month
          <input className="sf-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        </label>
        <label style={labelStyle}>
          From
          <input className="sf-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        </label>
        <label style={labelStyle}>
          To
          <input className="sf-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </label>
        <button type="submit" disabled={loading} style={{ ...primaryBtn, alignSelf: "flex-end", opacity: loading ? 0.6 : 1 }}>
          {loading ? "Loading…" : "Show"}
        </button>
      </form>
      {range ? (
        <p style={{ ...mutedStyle, margin: "0 0 12px" }}>
          Showing {range.from} → {range.to} · {rows.length} {rows.length === 1 ? "student" : "students"}
        </p>
      ) : null}
      {loading ? (
        <SkeletonBlocks rows={6} height={48} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<BarChart3 size={22} aria-hidden="true" />}
          title="No attendance in this range"
          detail="Nothing was marked for these filters yet — pick another month or check the section."
        />
      ) : (
        <div className="sf-card" style={{ overflow: "hidden" }}>
          <div className="sf-table-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Student</th>
                  <th style={th}>Days</th>
                  <th style={th}>Present</th>
                  <th style={th}>%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.studentId}>
                    <td style={td}>{row.name}</td>
                    <td style={td}>{row.total}</td>
                    <td style={td}>{row.present}</td>
                    <td style={{ ...td, color: percentTone(row.percent), fontWeight: 700 }}>{row.percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
