"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";

interface Me {
  id: string;
  name: string;
  email: string;
  schoolId: string | null;
  role: string;
}

interface GrowthPoint {
  month: string;
  count: number;
}

interface ActivityItem {
  kind: "notice" | "homework" | "exam" | "payment";
  title: string;
  at: string;
}

interface AdminBundle {
  totalStudents: number;
  totalTeachers: number;
  totalClasses: number;
  feeCollection: string;
  growth: GrowthPoint[];
  activities: ActivityItem[];
  asOf: { day: string; month: string };
}

interface ApiError {
  error: { code: string; message: string };
}

// School Admin dashboard (§7 Phase 1 #9, §8.3): navy sidebar with the
// canonical admin nav (§8.4), greeting header, 4 KPI cards, Student Growth
// chart, Recent Activities feed, Quick Actions. Every number comes from
// GET .../dashboard/admin — zeros render as zeros, never as mockup filler
// (§8.1: no fabricated stats). Same token-paste dev workflow as the other
// boards until login lands. Chart is hand-rolled SVG (no chart dependency,
// no audit surface); icons are inline SVG in the Lucide stroke style
// (§8.5: Lucide only, no second icon set).

const NAVY = "#0F172A";
const PRIMARY = "#2563EB";
const CANVAS = "#F8FAFC";
const SUCCESS = "#059669";
const WARNING = "#D97706";
const DANGER = "#DC2626";

const NAV: { label: string; href: string | null }[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Students", href: "/students" },
  { label: "Teachers", href: null },
  { label: "Classes & Sections", href: "/sections" },
  { label: "Attendance", href: "/attendance/mark" },
  { label: "Fees & Payments", href: "/fees" },
  { label: "Exams & Marks", href: "/exams/results" },
  { label: "Timetable", href: "/timetable" },
  { label: "Homework", href: "/homework" },
  { label: "Communication", href: "/messages" },
  { label: "Reports", href: null },
  { label: "Settings", href: null },
];

const KIND_COLORS: Record<ActivityItem["kind"], string> = {
  notice: PRIMARY,
  homework: WARNING,
  exam: "#7C3AED",
  payment: SUCCESS,
};

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

function monthLabel(yyyyMm: string): string {
  const [year, month] = yyyyMm.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const name = names[(month ?? 1) - 1] ?? "";
  return `${name} ${String(year ?? "").slice(2)}`;
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

function GrowthChart({ growth }: { growth: GrowthPoint[] }): ReactNode {
  const width = 600;
  const height = 220;
  const padLeft = 36;
  const padBottom = 28;
  const padTop = 12;
  const max = Math.max(1, ...growth.map((p) => p.count));
  const stepX = growth.length > 1 ? (width - padLeft - 8) / (growth.length - 1) : 0;
  const points = growth.map((p, i) => ({
    x: padLeft + i * stepX,
    y: padTop + (height - padTop - padBottom) * (1 - p.count / max),
    ...p,
  }));
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${(points[points.length - 1]?.x ?? 0).toFixed(1)},${height - padBottom} L${padLeft},${height - padBottom} Z`;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Student admissions per month">
      <defs>
        <linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={PRIMARY} stopOpacity="0.25" />
          <stop offset="100%" stopColor={PRIMARY} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => {
        const y = padTop + (height - padTop - padBottom) * (1 - t / max);
        return (
          <g key={t}>
            <line x1={padLeft} y1={y} x2={width - 8} y2={y} stroke="#E2E8F0" strokeWidth="1" />
            <text x={padLeft - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#64748B">
              {t}
            </text>
          </g>
        );
      })}
      <path d={area} fill="url(#growthFill)" />
      <path d={line} fill="none" stroke={PRIMARY} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p) => (
        <g key={p.month}>
          <circle cx={p.x} cy={p.y} r="4" fill="#fff" stroke={PRIMARY} strokeWidth="2.5" />
          <text x={p.x} y={height - 8} textAnchor="middle" fontSize="11" fill="#64748B">
            {monthLabel(p.month)}
          </text>
        </g>
      ))}
    </svg>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(15,23,42,.08)",
  padding: 20,
};

export default function DashboardPage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [bundle, setBundle] = useState<AdminBundle | null>(null);
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
          fetch(`${api}/api/v1/schools/${schoolId}/dashboard/admin`, { headers: auth }),
        ]);
        const meBody = (await meRes.json()) as { data: { user: Me } } | ApiError;
        if (!meRes.ok || "error" in meBody) {
          throw new Error("error" in meBody ? (meBody.error?.message ?? "Sign-in failed.") : "Sign-in failed.");
        }
        const dashBody = (await dashRes.json()) as { data: { dashboard: AdminBundle } } | ApiError;
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
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>School Admin Dashboard</h1>
        <p style={{ color: "#64748B", margin: "0 0 20px" }}>Paste a school-id + admin token to load the live board.</p>
        <form onSubmit={connect} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
            School ID
            <input value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required style={{ padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
            Admin token
            <input value={token} onChange={(e) => setToken(e.target.value)} required style={{ padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }} />
          </label>
          <button type="submit" disabled={loading} style={{ padding: 12, borderRadius: 10, border: 0, background: PRIMARY, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Loading…" : "Load dashboard"}
          </button>
          {error ? <p style={{ color: DANGER, fontSize: 14 }}>{error}</p> : null}
        </form>
      </main>
    );
  }

  const kpis = [
    { label: "Total Students", value: String(bundle.totalStudents), color: PRIMARY, icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75" },
    { label: "Total Teachers", value: String(bundle.totalTeachers), color: SUCCESS, icon: "M22 10 12 5 2 10l10 5 10-5 M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" },
    { label: "Total Classes", value: String(bundle.totalClasses), color: "#7C3AED", icon: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10" },
    { label: "Fee Collection", value: inr(bundle.feeCollection), color: WARNING, icon: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16V7 M18 12a2 2 0 0 0 0 4h-4a2 2 0 0 1 0-4z" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif", background: CANVAS }}>
      <aside style={{ width: 248, background: NAVY, color: "#E2E8F0", padding: "20px 14px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 16px" }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: PRIMARY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20 }}>S</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>Studyfy</span>
        </div>
        <div style={{ margin: "0 8px 16px", display: "inline-block", fontSize: 12, fontWeight: 600, background: PRIMARY, color: "#fff", borderRadius: 999, padding: "4px 12px" }}>
          School Admin
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
                  background: item.href === "/dashboard" ? PRIMARY : "transparent",
                  color: item.href === "/dashboard" ? "#fff" : "#CBD5E1",
                  fontWeight: item.href === "/dashboard" ? 600 : 400,
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
            Here is what is happening at your school today · {bundle.asOf.day}
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
              <div style={{ fontSize: 28, fontWeight: 700, color: NAVY }}>{kpi.value}</div>
            </div>
          ))}
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 20 }}>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 4px", color: NAVY }}>Student Growth</h2>
            <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>Admissions per month, last 6 months</p>
            <GrowthChart growth={bundle.growth} />
          </div>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Quick Actions</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {[
                { label: "Admit Student", href: "/students/new" },
                { label: "Mark Attendance", href: "/attendance/mark" },
                { label: "Collect Fee", href: "/fees" },
                { label: "Post Notice", href: "/notices" },
              ].map((action) => (
                <a
                  key={action.label}
                  href={action.href}
                  style={{ display: "block", textAlign: "center", padding: "11px 0", borderRadius: 10, background: PRIMARY, color: "#fff", fontWeight: 600, fontSize: 14, textDecoration: "none" }}
                >
                  {action.label}
                </a>
              ))}
            </div>
          </div>
        </section>

        <section style={card}>
          <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Recent Activities</h2>
          {bundle.activities.length === 0 ? (
            <div style={{ border: "1px dashed #CBD5E1", borderRadius: 12, padding: 24, textAlign: "center", color: "#64748B", fontSize: 14 }}>
              Nothing yet — notices, homework, exams, and payments will appear here as they happen.
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 0 }}>
              {bundle.activities.map((activity, index) => (
                <li
                  key={`${activity.kind}-${activity.at}-${index}`}
                  style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderTop: index === 0 ? 0 : "1px solid #F1F5F9" }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: KIND_COLORS[activity.kind], marginTop: 5, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: NAVY }}>{activity.title}</div>
                    <div style={{ fontSize: 12, color: "#64748B", textTransform: "capitalize" }}>
                      {activity.kind} · {new Date(activity.at).toLocaleString()}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
