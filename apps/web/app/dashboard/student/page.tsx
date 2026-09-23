"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";

interface Me {
  id: string;
  name: string;
  email: string;
  schoolId: string | null;
  role: string;
}

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

// Student board (§7 Phase 1 #9, §8.3): teal student badge, the canonical
// student nav (§8.4), greeting, 4 KPI cards (Attendance %, Overall Marks,
// Fees Due, Next Exam), Today's Timetable, Recent Marks, Recent Notices,
// Quick Links. Same rules as the other boards: every figure from GET
// .../dashboard/student; nulls render as "no data yet", never as invented
// numbers (§8.1); token-paste until login; skeleton loading (§8.5).

const NAVY = "#0F172A";
const STUDENT_TEAL = "#0D9488";
const PRIMARY = "#2563EB";
const CANVAS = "#F8FAFC";
const WARNING = "#D97706";
const DANGER = "#DC2626";

const NAV: { label: string; href: string | null }[] = [
  { label: "Dashboard", href: "/dashboard/student" },
  { label: "Attendance", href: null },
  { label: "Marks & Results", href: "/exams/results" },
  { label: "Homework", href: "/homework" },
  { label: "Timetable", href: "/timetable" },
  { label: "Fees & Payments", href: "/fees" },
  { label: "Notices", href: "/notices" },
  { label: "Messages", href: "/messages" },
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

function inr(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return `₹${amount}`;
  }
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

const emptyBox: React.CSSProperties = {
  border: "1px dashed #CBD5E1",
  borderRadius: 12,
  padding: 24,
  textAlign: "center",
  color: "#64748B",
  fontSize: 14,
};

export default function StudentDashboardPage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [bundle, setBundle] = useState<StudentBundle | null>(null);
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
          fetch(`${api}/api/v1/schools/${schoolId}/dashboard/student`, { headers: auth }),
        ]);
        const meBody = (await meRes.json()) as { data: { user: Me } } | ApiError;
        if (!meRes.ok || "error" in meBody) {
          throw new Error("error" in meBody ? (meBody.error?.message ?? "Sign-in failed.") : "Sign-in failed.");
        }
        if (meBody.data.user.role !== "STUDENT") {
          throw new Error("This board is for students — your account holds a different role.");
        }
        const dashBody = (await dashRes.json()) as { data: { dashboard: StudentBundle } } | ApiError;
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
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Student Dashboard</h1>
        <p style={{ color: "#64748B", margin: "0 0 20px" }}>Paste a school-id + student token to load your board.</p>
        <form onSubmit={connect} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
            School ID
            <input value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required style={{ padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
            Student token
            <input value={token} onChange={(e) => setToken(e.target.value)} required style={{ padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }} />
          </label>
          <button type="submit" disabled={loading} style={{ padding: 12, borderRadius: 10, border: 0, background: STUDENT_TEAL, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
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

  const kpis = [
    { label: "Attendance", value: bundle.attendancePercent === null ? "No data yet" : `${bundle.attendancePercent}%`, color: STUDENT_TEAL, icon: "M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
    { label: "Overall Marks", value: bundle.overallMarks === null ? "No data yet" : `${bundle.overallMarks}%`, color: PRIMARY, icon: "M22 10 12 5 2 10l10 5 10-5 M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" },
    { label: "Fees Due", value: inr(bundle.feesDue), color: Number(bundle.feesDue) > 0 ? WARNING : STUDENT_TEAL, icon: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16V7 M18 12a2 2 0 0 0 0 4h-4a2 2 0 0 1 0-4z" },
    { label: "Next Exam", value: bundle.nextExam ? bundle.nextExam.title : "None scheduled", sub: bundle.nextExam?.date ?? null, color: "#7C3AED", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif", background: CANVAS }}>
      <aside style={{ width: 248, background: NAVY, color: "#E2E8F0", padding: "20px 14px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 16px" }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: PRIMARY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20 }}>S</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>Studyfy</span>
        </div>
        <div style={{ margin: "0 8px 16px", display: "inline-block", fontSize: 12, fontWeight: 600, background: STUDENT_TEAL, color: "#fff", borderRadius: 999, padding: "4px 12px" }}>
          Student
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
                  background: item.href === "/dashboard/student" ? STUDENT_TEAL : "transparent",
                  color: item.href === "/dashboard/student" ? "#fff" : "#CBD5E1",
                  fontWeight: item.href === "/dashboard/student" ? 600 : 400,
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
            Your school day at a glance · {bundle.asOf.day}
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
              <div style={{ fontSize: 22, fontWeight: 700, color: NAVY }}>{kpi.value}</div>
              {"sub" in kpi && kpi.sub ? <div style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>{kpi.sub}</div> : null}
            </div>
          ))}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 20 }}>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Today&apos;s Timetable</h2>
            {bundle.todayTimetable.length === 0 ? (
              <div style={emptyBox}>No lessons scheduled for you today.</div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {bundle.todayTimetable.map((slot, index) => (
                  <li key={`${slot.period}-${index}`} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderTop: index === 0 ? 0 : "1px solid #F1F5F9" }}>
                    <span style={{ minWidth: 72, fontSize: 13, fontWeight: 700, color: STUDENT_TEAL }}>Period {slot.period}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, color: NAVY, fontWeight: 600 }}>{slot.subjectName}</div>
                      <div style={{ fontSize: 12, color: "#64748B" }}>
                        {slot.startTime ? `${slot.startTime}` : ""}
                        {slot.endTime ? ` – ${slot.endTime}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Quick Links</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {[
                { label: "My Homework", href: "/homework" },
                { label: "My Timetable", href: "/timetable" },
                { label: "Pay Fees", href: "/fees" },
                { label: "Messages", href: "/messages" },
              ].map((action) => (
                <a
                  key={action.label}
                  href={action.href}
                  style={{ display: "block", textAlign: "center", padding: "11px 0", borderRadius: 10, background: STUDENT_TEAL, color: "#fff", fontWeight: 600, fontSize: 14, textDecoration: "none" }}
                >
                  {action.label}
                </a>
              ))}
            </div>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Recent Marks</h2>
            {bundle.recentMarks.length === 0 ? (
              <div style={emptyBox}>No marks entered yet — they will appear here.</div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {bundle.recentMarks.map((mark) => (
                  <li key={mark.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid #F1F5F9", fontSize: 14 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: NAVY, fontWeight: 600 }}>{mark.subjectName}</div>
                      <div style={{ fontSize: 12, color: "#64748B" }}>{mark.examName}</div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: mark.percent === null ? "#64748B" : mark.percent >= 40 ? STUDENT_TEAL : DANGER }}>
                      {mark.percent === null ? "Awaited" : `${mark.obtained}/${mark.max}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Recent Notices</h2>
            {bundle.recentNotices.length === 0 ? (
              <div style={emptyBox}>No notices for you right now.</div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {bundle.recentNotices.map((notice) => (
                  <li key={notice.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid #F1F5F9", fontSize: 14 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: PRIMARY, marginTop: 5, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ color: NAVY }}>{notice.title}</div>
                      <div style={{ fontSize: 12, color: "#64748B" }}>{new Date(notice.at).toLocaleDateString()}</div>
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
