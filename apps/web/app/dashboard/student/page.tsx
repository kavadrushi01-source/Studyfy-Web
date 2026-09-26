"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bell, CalendarDays, FileText, GraduationCap, UserCheck, Wallet } from "lucide-react";
import { Card, EmptyState, SectionTitle, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, iconTile, mutedStyle, pill } from "@/lib/theme";
import { isFailure } from "../../../lib/api";

interface TimetableSlot {
  period: number;
  subjectName: string;
  sectionName: string;
  className: string;
  startTime: string | null;
  endTime: string | null;
}

interface MarkItem {
  id: string;
  subjectName: string;
  examName: string;
  obtained: string | null;
  max: string;
  percent: number | null;
}

interface NoticeItem {
  id: string;
  title: string;
  at: string;
}

interface StudentBundle {
  attendancePercent: number | null;
  overallMarks: number | null;
  feesDue: string;
  nextExam: { id: string; title: string; date: string | null } | null;
  todayTimetable: TimetableSlot[];
  recentMarks: MarkItem[];
  recentNotices: NoticeItem[];
  asOf: { day: string };
}

interface ApiError {
  error: { code: string; message: string };
}

// Student board (§7 Phase 1 #9, §8.3): shared Shell with the canonical
// student nav (§8.4), greeting, 4 KPI cards (Attendance %, Overall Marks,
// Fees Due, Next Exam), Today's Timetable, Recent Marks, Recent Notices,
// Quick Links. Same rules as the other boards: every figure from GET
// .../dashboard/student; nulls render as "no data yet", never as invented
// numbers (§8.1); token-paste until login; skeleton loading (§8.5).

// Feed rows lift softly on hover (same motion language as DataTable rows).
function rowHoverIn(e: React.MouseEvent<HTMLElement>): void {
  e.currentTarget.style.background = colors.canvas;
}

function rowHoverOut(e: React.MouseEvent<HTMLElement>): void {
  e.currentTarget.style.background = "transparent";
}

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) {
    return "Good morning";
  }
  if (hour < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

function inr(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return `₹${amount}`;
  }
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function StudentDashboardPage() {
  const { token, schoolId, user, ready, apiFetch } = useAuth();
  const [bundle, setBundle] = useState<StudentBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const dashRes = await apiFetch(`/api/v1/schools/${schoolId}/dashboard/student`);
        const dashBody = (await dashRes.json()) as { data: { dashboard: StudentBundle } } | ApiError;
        if (isFailure(dashRes, dashBody)) {
          throw new Error(dashBody.error?.message ?? "Dashboard unavailable.");
        }
        if (!cancelled) {
          setBundle(dashBody.data.dashboard);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Network error.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, token, schoolId, apiFetch]);

  if (!ready) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
        <SkeletonBlocks rows={3} />
      </main>
    );
  }

  if (!token) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Please sign in</h1>
        <p style={{ color: colors.muted, margin: "0 0 20px" }}>Sign in to view your student board.</p>
        <Link
          href="/login"
          className="sf-btn sf-btn-primary"
          style={{ display: "inline-flex", textDecoration: "none" }}
        >
          Go to sign in
        </Link>
      </main>
    );
  }

  if (!schoolId) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Student Dashboard</h1>
        <p style={{ color: colors.danger, fontSize: 14 }}>No school on this account</p>
      </main>
    );
  }

  if (user && user.role !== "STUDENT") {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Student Dashboard</h1>
        <p style={{ color: colors.danger, fontSize: 14 }}>This board is for students — your account holds a different role.</p>
      </main>
    );
  }

  if (loading || !bundle) {
    return (
      <Shell role="STUDENT" activeHref="/dashboard/student">
        {error ? <p style={{ color: colors.danger, fontSize: 14 }}>{error}</p> : null}
        <SkeletonBlocks rows={3} />
      </Shell>
    );
  }

  const kpis: { label: string; value: string; sub?: string | null; color: string; tint: string; icon: ReactNode }[] = [
    { label: "Attendance", value: bundle.attendancePercent === null ? "No data yet" : `${bundle.attendancePercent}%`, color: colors.success, tint: colors.successTint, icon: <UserCheck size={22} /> },
    { label: "Overall Marks", value: bundle.overallMarks === null ? "No data yet" : `${bundle.overallMarks}%`, color: colors.primary, tint: colors.primaryGhost, icon: <GraduationCap size={22} /> },
    { label: "Fees Due", value: inr(bundle.feesDue), color: Number(bundle.feesDue) > 0 ? colors.warning : colors.success, tint: Number(bundle.feesDue) > 0 ? colors.warningTint : colors.successTint, icon: <Wallet size={22} /> },
    { label: "Next Exam", value: bundle.nextExam ? bundle.nextExam.title : "None scheduled", sub: bundle.nextExam?.date ?? null, color: colors.accent, tint: colors.accentTint, icon: <FileText size={22} /> },
  ];

  return (
    <Shell role="STUDENT" activeHref="/dashboard/student">
      <header style={{ marginBottom: 24 }}>
        <h1 style={h1Style}>
          {greeting(new Date())}, {user?.name ?? ""}
        </h1>
        <p style={{ ...mutedStyle, margin: "4px 0 0" }}>
          Your school day at a glance · {bundle.asOf.day}
        </p>
      </header>

      <section className="sf-grid-kpi" style={{ marginBottom: 20 }}>
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: colors.muted }}>{kpi.label}</span>
              <span style={iconTile(kpi.color, kpi.tint)}>{kpi.icon}</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: colors.ink }}>{kpi.value}</div>
            {"sub" in kpi && kpi.sub ? <div style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>{kpi.sub}</div> : null}
          </Card>
        ))}
      </section>

      <section className="sf-grid-2-1" style={{ marginBottom: 20 }}>
        <Card>
          <SectionTitle>Today&apos;s Timetable</SectionTitle>
          {bundle.todayTimetable.length === 0 ? (
            <EmptyState icon={<CalendarDays size={22} />} title="No lessons today" detail="No lessons scheduled for you today." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {bundle.todayTimetable.map((slot, index) => (
                <li
                  key={`${slot.period}-${index}`}
                  onMouseEnter={rowHoverIn}
                  onMouseLeave={rowHoverOut}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px 8px",
                    margin: "0 -8px",
                    borderRadius: 10,
                    transition: "background 140ms cubic-bezier(.22,1,.36,1)",
                    borderTop: index === 0 ? 0 : `1px solid ${colors.lineSoft}`,
                  }}
                >
                  <span style={{ minWidth: 72, fontSize: 13, fontWeight: 700, color: colors.success }}>Period {slot.period}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: colors.ink, fontWeight: 600 }}>{slot.subjectName}</div>
                    <div style={{ fontSize: 12, color: colors.muted }}>
                      {slot.startTime ? `${slot.startTime}` : ""}
                      {slot.endTime ? ` – ${slot.endTime}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Quick Links</SectionTitle>
          <div style={{ display: "grid", gap: 12 }}>
            {[
              { label: "My Homework", href: "/homework" },
              { label: "My Timetable", href: "/timetable" },
              { label: "Pay Fees", href: "/fees" },
              { label: "Messages", href: "/messages" },
            ].map((action, index) => (
              <a
                key={action.label}
                href={action.href}
                className={index === 0 ? "sf-btn sf-btn-primary" : "sf-btn sf-btn-secondary"}
                style={{ width: "100%", textDecoration: "none" }}
              >
                {action.label}
              </a>
            ))}
          </div>
        </Card>
      </section>

      <section className="sf-grid-1-1">
        <Card>
          <SectionTitle>Recent Marks</SectionTitle>
          {bundle.recentMarks.length === 0 ? (
            <EmptyState icon={<GraduationCap size={22} />} title="No marks yet" detail="No marks entered yet — they will appear here." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {bundle.recentMarks.map((mark) => (
                <li
                  key={mark.id}
                  onMouseEnter={rowHoverIn}
                  onMouseLeave={rowHoverOut}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    padding: "8px 8px",
                    margin: "0 -8px",
                    borderRadius: 10,
                    transition: "background 140ms cubic-bezier(.22,1,.36,1)",
                    borderTop: `1px solid ${colors.lineSoft}`,
                    fontSize: 14,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ color: colors.ink, fontWeight: 600 }}>{mark.subjectName}</div>
                    <div style={{ fontSize: 12, color: colors.muted }}>{mark.examName}</div>
                  </div>
                  <span style={mark.percent === null ? pill(colors.muted, colors.lineSoft) : mark.percent >= 40 ? pill(colors.success, colors.successTint) : pill(colors.danger, colors.dangerTint)}>
                    {mark.percent === null ? "Awaited" : `${mark.obtained}/${mark.max}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Recent Notices</SectionTitle>
          {bundle.recentNotices.length === 0 ? (
            <EmptyState icon={<Bell size={22} />} title="No notices" detail="No notices for you right now." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {bundle.recentNotices.map((notice) => (
                <li
                  key={notice.id}
                  onMouseEnter={rowHoverIn}
                  onMouseLeave={rowHoverOut}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "8px 8px",
                    margin: "0 -8px",
                    borderRadius: 10,
                    transition: "background 140ms cubic-bezier(.22,1,.36,1)",
                    borderTop: `1px solid ${colors.lineSoft}`,
                    fontSize: 14,
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      background: colors.primaryGhost,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 3,
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: colors.primary }} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: colors.ink, fontWeight: 600 }}>{notice.title}</div>
                    <div style={{ fontSize: 12, color: colors.muted }}>{new Date(notice.at).toLocaleDateString()}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </Shell>
  );
}
