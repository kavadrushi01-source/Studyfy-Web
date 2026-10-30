"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SignInLink } from "@/components/ui/sign-in-gate";
import { BookOpen, CalendarDays, ClipboardCheck, FileText, MessageSquare, School } from "lucide-react";
import { Card, EmptyState, SectionTitle, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, iconTile, mutedStyle, pill } from "@/lib/theme";
import { isFailure } from "../../../lib/api";

interface TeacherClassInfo {
  id: string;
  name: string;
  className: string;
}

interface AttendanceStatus {
  sectionId: string;
  sectionName: string;
  className: string;
  marked: boolean;
  present: number;
  total: number;
}

interface TimetableSlot {
  period: number;
  subjectName: string;
  sectionName: string;
  className: string;
  startTime: string | null;
  endTime: string | null;
}

interface UpcomingItem {
  id: string;
  title: string;
  date: string | null;
  sectionName: string | null;
}

interface RecentMessage {
  user: { id: string; name: string };
  lastBody: string;
  unread: number;
}

interface TeacherBundle {
  myClasses: TeacherClassInfo[];
  todayAttendance: AttendanceStatus[];
  homeworkPending: number;
  unreadMessages: number;
  todayTimetable: TimetableSlot[];
  upcomingHomework: UpcomingItem[];
  upcomingExams: UpcomingItem[];
  recentMessages: RecentMessage[];
  asOf: { day: string };
}

interface ApiError {
  error: { code: string; message: string };
}

// Teacher "Today" board (§7 Phase 1 #9, §8.3): shared Shell with the
// canonical teacher nav (§8.4), greeting, 4 KPI cards (My Classes, Today's
// Attendance, Homework Pending, Messages), Today's Timetable, Quick
// Actions, Upcoming Homework/Exams, Recent Messages. Same rules as the
// admin board: every number from GET .../dashboard/teacher, zeros are
// zeros (§8.1), token-paste until login, skeleton loading (§8.5).

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

export default function TeacherDashboardPage() {
  const { token, schoolId, user, ready, apiFetch } = useAuth();
  const [bundle, setBundle] = useState<TeacherBundle | null>(null);
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
        const dashRes = await apiFetch(`/api/v1/schools/${schoolId}/dashboard/teacher`);
        const dashBody = (await dashRes.json()) as { data: { dashboard: TeacherBundle } } | ApiError;
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
        <p style={{ color: colors.muted, margin: "0 0 20px" }}>Sign in to view your teacher board.</p>
        <SignInLink
          className="sf-btn sf-btn-primary"
          style={{ display: "inline-flex", textDecoration: "none" }}
        >
          Go to sign in
        </SignInLink>
      </main>
    );
  }

  if (!schoolId) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Teacher Dashboard</h1>
        <p style={{ color: colors.danger, fontSize: 14 }}>No school on this account</p>
      </main>
    );
  }

  if (user && user.role !== "TEACHER") {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Teacher Dashboard</h1>
        <p style={{ color: colors.danger, fontSize: 14 }}>This board is for teachers — your account holds a different role.</p>
      </main>
    );
  }

  if (loading || !bundle) {
    return (
      <Shell role="TEACHER" activeHref="/dashboard/teacher">
        {error ? <p style={{ color: colors.danger, fontSize: 14 }}>{error}</p> : null}
        <SkeletonBlocks rows={3} />
      </Shell>
    );
  }

  const marked = bundle.todayAttendance.filter((s) => s.marked).length;
  const kpis: { label: string; value: string; color: string; tint: string; icon: ReactNode }[] = [
    { label: "My Classes", value: String(bundle.myClasses.length), color: colors.primary, tint: colors.primaryGhost, icon: <School size={22} /> },
    { label: "Today's Attendance", value: `${marked}/${bundle.todayAttendance.length} marked`, color: colors.success, tint: colors.successTint, icon: <ClipboardCheck size={22} /> },
    { label: "Homework Pending", value: String(bundle.homeworkPending), color: colors.warning, tint: colors.warningTint, icon: <BookOpen size={22} /> },
    { label: "Messages", value: bundle.unreadMessages === 0 ? "All read" : `${bundle.unreadMessages} unread`, color: colors.accent, tint: colors.accentTint, icon: <MessageSquare size={22} /> },
  ];

  return (
    <Shell role="TEACHER" activeHref="/dashboard/teacher">
      <header style={{ marginBottom: 24 }}>
        <h1 style={h1Style}>
          {greeting(new Date())}, {user?.name ?? ""}
        </h1>
        <p style={{ ...mutedStyle, margin: "4px 0 0" }}>
          Here is your day · {bundle.asOf.day}
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
                  <span style={{ minWidth: 72, fontSize: 13, fontWeight: 700, color: colors.primary }}>Period {slot.period}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: colors.ink, fontWeight: 600 }}>{slot.subjectName}</div>
                    <div style={{ fontSize: 12, color: colors.muted }}>
                      {slot.className} · {slot.sectionName}
                      {slot.startTime ? ` · ${slot.startTime}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 20 }}>
            <SectionTitle>Today&apos;s Attendance</SectionTitle>
          </div>
          {bundle.todayAttendance.length === 0 ? (
            <EmptyState icon={<ClipboardCheck size={22} />} title="No classes assigned" detail="No classes assigned yet." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {bundle.todayAttendance.map((row) => (
                <li
                  key={row.sectionId}
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
                  <span style={{ flex: 1, color: colors.inkSoft }}>
                    {row.className} · {row.sectionName}
                  </span>
                  <span style={row.marked ? pill(colors.success, colors.successTint) : pill(colors.warning, colors.warningTint)}>
                    {row.marked ? `${row.present}/${row.total} present` : "Not marked"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Quick Actions</SectionTitle>
          <div style={{ display: "grid", gap: 12 }}>
            {[
              { label: "Mark Attendance", href: "/attendance/mark" },
              { label: "Post Homework", href: "/homework" },
              { label: "Enter Marks", href: "/exams/results" },
              { label: "View Messages", href: "/messages" },
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
          <SectionTitle>Upcoming Homework &amp; Exams</SectionTitle>
          {bundle.upcomingHomework.length === 0 && bundle.upcomingExams.length === 0 ? (
            <EmptyState icon={<FileText size={22} />} title="Nothing upcoming" detail="Nothing upcoming — enjoy the quiet." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {bundle.upcomingHomework.map((item) => (
                <li
                  key={`hw-${item.id}`}
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
                      background: colors.warningTint,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 3,
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: colors.warning }} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: colors.ink, fontWeight: 600 }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: colors.muted }}>
                      Homework{item.sectionName ? ` · ${item.sectionName}` : ""} · due {item.date ?? "no date"}
                    </div>
                  </div>
                </li>
              ))}
              {bundle.upcomingExams.map((item) => (
                <li
                  key={`ex-${item.id}`}
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
                      background: colors.accentTint,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 3,
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: colors.accent }} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: colors.ink, fontWeight: 600 }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: colors.muted }}>Exam · {item.date ?? "date to be announced"}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Recent Messages</SectionTitle>
          {bundle.recentMessages.length === 0 ? (
            <EmptyState icon={<MessageSquare size={22} />} title="No conversations yet" detail="Messages from parents and students land here." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {bundle.recentMessages.map((message) => (
                <li
                  key={message.user.id}
                  onMouseEnter={rowHoverIn}
                  onMouseLeave={rowHoverOut}
                  style={{
                    padding: "8px 8px",
                    margin: "0 -8px",
                    borderRadius: 10,
                    transition: "background 140ms cubic-bezier(.22,1,.36,1)",
                    borderTop: `1px solid ${colors.lineSoft}`,
                    fontSize: 14,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 600, color: colors.ink, flex: 1, minWidth: 0 }}>{message.user.name}</span>
                    {message.unread > 0 ? (
                      <span style={pill(colors.primary, colors.primaryGhost)}>
                        {message.unread} new
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 13, color: colors.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {message.lastBody}
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
