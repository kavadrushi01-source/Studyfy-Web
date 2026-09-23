"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";

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

// Teacher "Today" board (§7 Phase 1 #9, §8.3): green teacher badge, the
// canonical teacher nav (§8.4), greeting, 4 KPI cards (My Classes, Today's
// Attendance, Homework Pending, Messages), Today's Timetable, Quick
// Actions, Upcoming Homework/Exams, Recent Messages. Same rules as the
// admin board: every number from GET .../dashboard/teacher, zeros are
// zeros (§8.1), token-paste until login, skeleton loading (§8.5).

const NAVY = "#0F172A";
const TEACHER_GREEN = "#059669";
const PRIMARY = "#2563EB";
const CANVAS = "#F8FAFC";
const WARNING = "#D97706";
const DANGER = "#DC2626";

const NAV: { label: string; href: string | null }[] = [
  { label: "Dashboard", href: "/dashboard/teacher" },
  { label: "My Classes", href: null },
  { label: "Attendance", href: "/attendance/mark" },
  { label: "Marks Entry", href: "/exams/results" },
  { label: "Homework", href: "/homework" },
  { label: "Timetable", href: "/timetable" },
  { label: "Messages", href: "/messages" },
  { label: "Resources", href: null },
  { label: "Profile", href: null },
  { label: "Settings", href: null },
];

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

function Icon({ d }: { d: string }): ReactNode {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(15,23,42,.08)",
  padding: 20,
};

const skeleton: React.CSSProperties = { height: 64, borderRadius: 14, background: "#F1F5F9", marginBottom: 12 };

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
        if (!meRes.ok || "error" in meBody) {
          throw new Error("error" in meBody ? (meBody.error?.message ?? "Sign-in failed.") : "Sign-in failed.");
        }
        if (meBody.data.user.role !== "TEACHER") {
          throw new Error("This board is for teachers — your account holds a different role.");
        }
        const dashBody = (await dashRes.json()) as { data: { dashboard: TeacherBundle } } | ApiError;
        if (!dashRes.ok || "error" in dashBody) {
          throw new Error("error" in dashBody ? (dashBody.error?.message ?? "Dashboard unavailable.") : "Dashboard unavailable.");
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
            {[0, 1, 2].map((i) => (
              <div key={i} style={skeleton} />
            ))}
          </div>
        ) : null}
      </main>
    );
  }

  const marked = bundle.todayAttendance.filter((s) => s.marked).length;
  const kpis = [
    { label: "My Classes", value: String(bundle.myClasses.length), color: PRIMARY, icon: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10" },
    { label: "Today's Attendance", value: `${marked}/${bundle.todayAttendance.length} marked`, color: TEACHER_GREEN, icon: "M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
    { label: "Homework Pending", value: String(bundle.homeworkPending), color: WARNING, icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8" },
    { label: "Messages", value: bundle.unreadMessages === 0 ? "All read" : `${bundle.unreadMessages} unread`, color: "#7C3AED", icon: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif", background: CANVAS }}>
      <aside style={{ width: 248, background: NAVY, color: "#E2E8F0", padding: "20px 14px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 16px" }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: PRIMARY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20 }}>S</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>Studyfy</span>
        </div>
        <div style={{ margin: "0 8px 16px", display: "inline-block", fontSize: 12, fontWeight: 600, background: TEACHER_GREEN, color: "#fff", borderRadius: 999, padding: "4px 12px" }}>
          Teacher
        </div>
        <nav style={{ display: "grid", gap: 2 }}>
          {NAV.map((item) =>
            item.href ? (
              <a
                key={item.label}
                href={item.href}
                style={{
                  display: "block",
                  padding: "9px 12px",
                  borderRadius: 10,
                  fontSize: 14,
                  textDecoration: "none",
                  background: item.href === "/dashboard/teacher" ? TEACHER_GREEN : "transparent",
                  color: item.href === "/dashboard/teacher" ? "#fff" : "#CBD5E1",
                  fontWeight: item.href === "/dashboard/teacher" ? 600 : 400,
                }}
              >
                {item.label}
              </a>
            ) : (
              <span key={item.label} style={{ display: "block", padding: "9px 12px", fontSize: 14, color: "#475569" }}>
                {item.label}
              </span>
            ),
          )}
        </nav>
      </aside>

      <main style={{ flex: 1, padding: 28, maxWidth: 1120 }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 26, margin: 0, color: NAVY }}>
            {greeting(new Date())}, {me.name}
          </h1>
          <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 14 }}>
            Here is your day · {bundle.asOf.day}
          </p>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 }}>
          {kpis.map((kpi) => (
            <div key={kpi.label} style={card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: "#64748B", fontWeight: 500 }}>{kpi.label}</span>
                <span style={{ color: kpi.color }}>
                  <Icon d={kpi.icon} />
                </span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: NAVY }}>{kpi.value}</div>
            </div>
          ))}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 20 }}>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Today&apos;s Timetable</h2>
            {bundle.todayTimetable.length === 0 ? (
              <div style={{ border: "1px dashed #CBD5E1", borderRadius: 12, padding: 24, textAlign: "center", color: "#64748B", fontSize: 14 }}>
                No lessons scheduled for you today.
              </div>
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
              <p style={{ fontSize: 14, color: "#64748B" }}>No classes assigned yet.</p>
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
          </div>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Quick Actions</h2>
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
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Upcoming Homework &amp; Exams</h2>
            {bundle.upcomingHomework.length === 0 && bundle.upcomingExams.length === 0 ? (
              <div style={{ border: "1px dashed #CBD5E1", borderRadius: 12, padding: 24, textAlign: "center", color: "#64748B", fontSize: 14 }}>
                Nothing upcoming — enjoy the quiet.
              </div>
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
          </div>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Recent Messages</h2>
            {bundle.recentMessages.length === 0 ? (
              <div style={{ border: "1px dashed #CBD5E1", borderRadius: 12, padding: 24, textAlign: "center", color: "#64748B", fontSize: 14 }}>
                No conversations yet — messages from parents and students land here.
              </div>
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
          </div>
        </section>
      </main>
    </div>
  );
}
