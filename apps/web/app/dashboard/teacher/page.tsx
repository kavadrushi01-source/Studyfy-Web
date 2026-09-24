"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { BookOpen, CalendarDays, ClipboardCheck, FileText, MessageSquare, School } from "lucide-react";
import { Card, EmptyState, SectionTitle, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";

interface Me {
  id: string;
  name: string;
  email: string;
  schoolId: string | null;
  role: string;
}

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

const NAVY = "#0F172A";
const TEACHER_GREEN = "#059669";
const PRIMARY = "#2563EB";
const WARNING = "#D97706";
const DANGER = "#DC2626";

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
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [bundle, setBundle] = useState<TeacherBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  const connect = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setLoading(true);
      setError("");
      try {
        const auth = { Authorization: `Bearer ${token}` };
        const [meRes, dashRes] = await Promise.all([
          fetch(`${api}/api/v1/auth/me`, { headers: auth }),
          fetch(`${api}/api/v1/schools/${schoolId}/dashboard/teacher`, { headers: auth }),
        ]);
        const meBody = (await meRes.json()) as { data: { user: Me } } | ApiError;
        if (isFailure(meRes, meBody)) {
          throw new Error(meBody.error?.message ?? "Sign-in failed.");
        }
        if (meBody.data.user.role !== "TEACHER") {
          throw new Error("This board is for teachers — your account holds a different role.");
        }
        const dashBody = (await dashRes.json()) as { data: { dashboard: TeacherBundle } } | ApiError;
        if (isFailure(dashRes, dashBody)) {
          throw new Error(dashBody.error?.message ?? "Dashboard unavailable.");
        }
        setMe(meBody.data.user);
        setBundle(dashBody.data.dashboard);
        setConnected(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [api, schoolId, token],
  );

  if (!connected || !me || !bundle) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Teacher Dashboard</h1>
        <p style={{ color: "#64748B", margin: "0 0 20px" }}>Paste a school-id + teacher token to load today&apos;s board.</p>
        <form onSubmit={connect} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
            School ID
            <input value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required style={{ padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
            Teacher token
            <input value={token} onChange={(e) => setToken(e.target.value)} required style={{ padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }} />
          </label>
          <button type="submit" disabled={loading} style={{ padding: 12, borderRadius: 10, border: 0, background: TEACHER_GREEN, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Loading…" : "Load dashboard"}
          </button>
          {error ? <p style={{ color: DANGER, fontSize: 14 }}>{error}</p> : null}
        </form>
        {loading ? (
          <div style={{ marginTop: 20 }}>
            <SkeletonBlocks rows={3} />
          </div>
        ) : null}
      </main>
    );
  }

  const marked = bundle.todayAttendance.filter((s) => s.marked).length;
  const kpis: { label: string; value: string; color: string; icon: ReactNode }[] = [
    { label: "My Classes", value: String(bundle.myClasses.length), color: PRIMARY, icon: <School size={22} /> },
    { label: "Today's Attendance", value: `${marked}/${bundle.todayAttendance.length} marked`, color: TEACHER_GREEN, icon: <ClipboardCheck size={22} /> },
    { label: "Homework Pending", value: String(bundle.homeworkPending), color: WARNING, icon: <BookOpen size={22} /> },
    { label: "Messages", value: bundle.unreadMessages === 0 ? "All read" : `${bundle.unreadMessages} unread`, color: "#7C3AED", icon: <MessageSquare size={22} /> },
  ];

  return (
    <Shell role="TEACHER" activeHref="/dashboard/teacher">
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, margin: 0, color: NAVY }}>
          {greeting(new Date())}, {me.name}
        </h1>
        <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 14 }}>
          Here is your day · {bundle.asOf.day}
        </p>
      </header>

      <section className="sf-grid-kpi" style={{ marginBottom: 20 }}>
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "#64748B", fontWeight: 500 }}>{kpi.label}</span>
              <span style={{ color: kpi.color }}>{kpi.icon}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: NAVY }}>{kpi.value}</div>
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
                <li key={`${slot.period}-${index}`} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderTop: index === 0 ? 0 : "1px solid #F1F5F9" }}>
                  <span style={{ minWidth: 72, fontSize: 13, fontWeight: 700, color: PRIMARY }}>Period {slot.period}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: NAVY, fontWeight: 600 }}>{slot.subjectName}</div>
                    <div style={{ fontSize: 12, color: "#64748B" }}>
                      {slot.className} · {slot.sectionName}
                      {slot.startTime ? ` · ${slot.startTime}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h2 style={{ fontSize: 16, margin: "20px 0 12px", color: NAVY }}>Today&apos;s Attendance</h2>
          {bundle.todayAttendance.length === 0 ? (
            <EmptyState icon={<ClipboardCheck size={22} />} title="No classes assigned" detail="No classes assigned yet." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {bundle.todayAttendance.map((row) => (
                <li key={row.sectionId} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid #F1F5F9", fontSize: 14 }}>
                  <span style={{ flex: 1, color: NAVY }}>
                    {row.className} · {row.sectionName}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 999,
                      padding: "3px 10px",
                      background: row.marked ? "#D1FAE5" : "#FEF3C7",
                      color: row.marked ? TEACHER_GREEN : WARNING,
                    }}
                  >
                    {row.marked ? `${row.present}/${row.total} present` : "Not marked"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Quick Actions</SectionTitle>
          <div style={{ display: "grid", gap: 10 }}>
            {[
              { label: "Mark Attendance", href: "/attendance/mark" },
              { label: "Post Homework", href: "/homework" },
              { label: "Enter Marks", href: "/exams/results" },
              { label: "View Messages", href: "/messages" },
            ].map((action) => (
              <a
                key={action.label}
                href={action.href}
                style={{ display: "block", textAlign: "center", padding: "11px 0", borderRadius: 10, background: TEACHER_GREEN, color: "#fff", fontWeight: 600, fontSize: 14, textDecoration: "none" }}
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
                <li key={`hw-${item.id}`} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid #F1F5F9", fontSize: 14 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: WARNING, marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: NAVY }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: "#64748B" }}>
                      Homework{item.sectionName ? ` · ${item.sectionName}` : ""} · due {item.date ?? "no date"}
                    </div>
                  </div>
                </li>
              ))}
              {bundle.upcomingExams.map((item) => (
                <li key={`ex-${item.id}`} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid #F1F5F9", fontSize: 14 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: "#7C3AED", marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: NAVY }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: "#64748B" }}>Exam · {item.date ?? "date to be announced"}</div>
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
                <li key={message.user.id} style={{ padding: "8px 0", borderTop: "1px solid #F1F5F9", fontSize: 14 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontWeight: 600, color: NAVY, flex: 1 }}>{message.user.name}</span>
                    {message.unread > 0 ? (
                      <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "2px 9px", background: PRIMARY, color: "#fff" }}>
                        {message.unread} new
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 13, color: "#64748B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
