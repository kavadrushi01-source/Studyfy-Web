"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { EmptyState, SkeletonBlocks, UpgradeLocked } from "../../components/ui/shell";
import { isFailure, upgradeLockedMessage } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, h2Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

interface TrendPoint {
  date: string;
  percent: number | null;
  marked: number;
}

interface FeePoint {
  month: string;
  collected: string;
}

interface ExamPerf {
  examId: string;
  examName: string;
  takers: number;
  averagePercent: number | null;
  topPercent: number | null;
  distribution: { grade: string; count: number }[];
}

interface SectionRow {
  sectionId: string;
  className: string;
  sectionName: string;
  pupils: number;
  attendancePercent: number | null;
}

interface Overview {
  attendanceTrend: TrendPoint[];
  feeTrend: FeePoint[];
  pendingFees: string;
  overdueFees: string;
  exams: ExamPerf[];
  sections: SectionRow[];
  asOf: { day: string; month: string };
}

interface ApiError {
  error: { code: string; message: string };
}

// Reports & Analytics (§7 Phase 3 #19): school-wide trends for the admin —
// attendance line, fee bars, exam cards with grade spread, section table.
// Hand-rolled SVG/divs (no chart lib in the bundle); every figure comes
// from the one cached overview call, nulls render as gaps/— never zeros.
export default function AnalyticsPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canView = user?.role === "SCHOOL_ADMIN";
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Plan-gate locked state (§16.1): a 403 PLAN_UPGRADE_REQUIRED on the main
  // load parks the server's upgrade message here and the page renders the
  // locked card instead of content or a bare error.
  const [locked, setLocked] = useState<string | null>(null);
  const [attendanceDays, setAttendanceDays] = useState("30");
  const [feeMonths, setFeeMonths] = useState("6");

  const load = useCallback(
    async (nextAttendance: string, nextFees: string) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      setLocked(null);
      try {
        const params = new URLSearchParams({ attendanceDays: nextAttendance, feeMonths: nextFees });
        const response = await apiFetch(`/api/v1/schools/${schoolId}/analytics/overview?${params}`);
        const body = (await response.json()) as { data: { analytics: Overview } } | ApiError;
        const upgrade = upgradeLockedMessage(body);
        if (upgrade) {
          setLocked(upgrade);
          return;
        }
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load analytics.");
        }
        setData(body.data.analytics);
      } catch (err) {
        setData(null);
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  useEffect(() => {
    if (!ready || !token || !schoolId || !canView) {
      return;
    }
    void load(attendanceDays, feeMonths);
  }, [ready, token, schoolId, apiFetch, canView, load]);

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Reports &amp; Analytics</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Reports &amp; Analytics</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to view analytics.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  if (locked) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Reports &amp; Analytics</h1>
        <UpgradeLocked message={locked} />
      </main>
    );
  }

  if (!canView) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Reports &amp; Analytics</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>
            School analytics are for the school admin — your boards carry your own figures.
          </p>
        </div>
      </main>
    );
  }

  const trend = data?.attendanceTrend ?? [];
  const width = 640;
  const height = 180;
  const pad = 28;
  const segments: string[] = [];
  let current = "";
  for (const p of trend) {
    if (p.percent === null) {
      if (current) {
        segments.push(current);
        current = "";
      }
      continue;
    }
    const x = trend.length > 1 ? pad + (trend.indexOf(p) / (trend.length - 1)) * (width - pad * 2) : width / 2;
    const y = pad + (1 - p.percent / 100) * (height - pad * 2);
    current += `${current ? " L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  if (current) {
    segments.push(current);
  }
  const maxFee = Math.max(1, ...((data?.feeTrend ?? []).map((f) => Number(f.collected))));

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Reports &amp; Analytics</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Trailing trends across attendance, fees, and exams{data ? ` · as of ${data.asOf.day}` : ""}.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load(attendanceDays, feeMonths);
        }}
        className="sf-row-wrap"
        style={{ alignItems: "flex-end", marginBottom: 12 }}
      >
        <label style={labelStyle}>
          Attendance window
          <select
            className="sf-select"
            value={attendanceDays}
            onChange={(e) => {
              setAttendanceDays(e.target.value);
              void load(e.target.value, feeMonths);
            }}
            aria-label="Attendance window"
          >
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
        </label>
        <label style={labelStyle}>
          Fee window
          <select
            className="sf-select"
            value={feeMonths}
            onChange={(e) => {
              setFeeMonths(e.target.value);
              void load(attendanceDays, e.target.value);
            }}
            aria-label="Fee window"
          >
            <option value="3">3 months</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
          </select>
        </label>
        <button type="submit" disabled={loading} style={{ ...primaryBtn, opacity: loading ? 0.6 : 1 }}>
          {loading ? "Loading…" : "Apply"}
        </button>
      </form>
      {loading ? (
        <SkeletonBlocks rows={6} />
      ) : data ? (
        <>
          <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
            <h2 style={h2Style}>Attendance trend — daily % present</h2>
            {trend.some((p) => p.percent !== null) ? (
              <svg
                viewBox={`0 0 ${width} ${height}`}
                style={{ width: "100%", height: "auto" }}
                role="img"
                aria-label="Daily attendance percent line chart"
              >
                {[0, 25, 50, 75, 100].map((g) => {
                  const y = pad + (1 - g / 100) * (height - pad * 2);
                  return (
                    <g key={g}>
                      <line x1={pad} x2={width - pad} y1={y} y2={y} stroke="#E2E8F0" strokeWidth={1} />
                      <text x={4} y={y + 3} fontSize={9} fill="#64748B">{`${g}%`}</text>
                    </g>
                  );
                })}
                {segments.map((d, i) => (
                  <path key={i} d={d} fill="none" stroke={colors.primary} strokeWidth={2} />
                ))}
              </svg>
            ) : (
              <EmptyState
                icon={<BarChart3 size={22} aria-hidden="true" />}
                title="No attendance marked in this window"
                detail="Mark a day on the attendance screen and the trend appears here."
              />
            )}
          </section>

          <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
            <h2 style={h2Style}>Fee collection — by month</h2>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", height: 150, marginTop: 8 }}>
              {data.feeTrend.map((f) => {
                const value = Number(f.collected);
                return (
                  <div key={f.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: colors.ink }}>₹{value.toLocaleString("en-IN")}</span>
                    <div
                      style={{
                        width: "70%",
                        height: Math.max(4, (value / maxFee) * 100),
                        background: value > 0 ? colors.primary : "#E2E8F0",
                        borderRadius: 6,
                      }}
                    />
                    <span style={{ fontSize: 12, color: colors.inkSoft }}>{f.month}</span>
                  </div>
                );
              })}
            </div>
            <p style={{ ...mutedStyle, fontSize: 13, margin: "12px 0 0" }}>
              Pending ₹{Number(data.pendingFees).toLocaleString("en-IN")} · Overdue ₹
              {Number(data.overdueFees).toLocaleString("en-IN")}
            </p>
          </section>

          <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
            <h2 style={h2Style}>Exam performance — latest exams</h2>
            {data.exams.length === 0 ? (
              <p style={{ ...mutedStyle, fontSize: 14, margin: 0 }}>No exams yet — performance cards appear here.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
                {data.exams.map((e) => {
                  const top = Math.max(1, ...e.distribution.map((g) => g.count));
                  return (
                    <li key={e.examId} style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: 12 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                        <strong style={{ color: colors.ink, fontSize: 15 }}>{e.examName}</strong>
                        <span style={pill(colors.primary, colors.primaryGhost)}>
                          {e.takers} {e.takers === 1 ? "taker" : "takers"}
                        </span>
                        <span style={{ fontSize: 13, color: colors.inkSoft }}>
                          avg {e.averagePercent === null ? "—" : `${e.averagePercent}%`} · top{" "}
                          {e.topPercent === null ? "—" : `${e.topPercent}%`}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                        {e.distribution.map((g) => (
                          <span
                            key={g.grade}
                            title={`${g.grade}: ${g.count}`}
                            style={{
                              minWidth: 34,
                              textAlign: "center",
                              fontSize: 12,
                              fontWeight: 700,
                              color: g.count > 0 ? colors.ink : colors.inkSoft,
                              background: g.count > 0 ? colors.primaryGhost : "#F1F5F9",
                              borderRadius: 8,
                              padding: "4px 6px",
                              opacity: g.count > 0 ? Math.max(0.45, g.count / top) + 0.2 : 1,
                            }}
                          >
                            {g.grade} {g.count}
                          </span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
            <h2 style={h2Style}>Sections — pupils and this month&apos;s attendance</h2>
            <div className="sf-table-scroll">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 13, color: colors.inkSoft, padding: "8px" }}>Section</th>
                    <th style={{ textAlign: "right", fontSize: 13, color: colors.inkSoft, padding: "8px" }}>Pupils</th>
                    <th style={{ textAlign: "right", fontSize: 13, color: colors.inkSoft, padding: "8px" }}>Month %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sections.map((s) => (
                    <tr key={s.sectionId} style={{ borderTop: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "8px", fontSize: 14, color: colors.ink, fontWeight: 600 }}>
                        {s.className} · {s.sectionName}
                      </td>
                      <td style={{ padding: "8px", fontSize: 14, textAlign: "right", color: colors.ink }}>{s.pupils}</td>
                      <td style={{ padding: "8px", fontSize: 14, textAlign: "right", color: colors.ink, fontWeight: 700 }}>
                        {s.attendancePercent === null ? "—" : `${s.attendancePercent}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
