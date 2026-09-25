"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { GraduationCap, Inbox, School, TrendingUp, Users, Wallet } from "lucide-react";
import { Card, EmptyState, SectionTitle, Shell, SkeletonBlocks } from "../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
import { isFailure } from "../../lib/api";

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

// School Admin dashboard (§7 Phase 1 #9, §8.3): shared Shell with the
// canonical admin nav (§8.4), greeting header, 4 KPI cards, Student Growth
// chart, Recent Activities feed, Quick Actions. Every number comes from
// GET .../dashboard/admin — zeros render as zeros, never as mockup filler
// (§8.1: no fabricated stats). Same token-paste dev workflow as the other
// boards until login lands. Chart is hand-rolled SVG (no chart dependency,
// no audit surface); icons are lucide-react (§8.5: Lucide only).

const NAVY = "#0F172A";
const PRIMARY = "#2563EB";
const SUCCESS = "#059669";
const WARNING = "#D97706";
const DANGER = "#DC2626";

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

export default function DashboardPage() {
  const { token, schoolId, user, ready, apiFetch } = useAuth();
  const [bundle, setBundle] = useState<AdminBundle | null>(null);
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
        const dashRes = await apiFetch(`/api/v1/schools/${schoolId}/dashboard/admin`);
        const dashBody = (await dashRes.json()) as { data: { dashboard: AdminBundle } } | ApiError;
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
        <p style={{ color: "#64748B", margin: "0 0 20px" }}>Sign in to view the school admin dashboard.</p>
        <Link
          href="/login"
          style={{ display: "inline-block", padding: "12px 24px", borderRadius: 10, background: PRIMARY, color: "#fff", fontWeight: 600, textDecoration: "none" }}
        >
          Go to sign in
        </Link>
      </main>
    );
  }

  if (!schoolId) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>School Admin Dashboard</h1>
        <p style={{ color: DANGER, fontSize: 14 }}>No school on this account</p>
      </main>
    );
  }

  if (loading || !bundle) {
    return (
      <Shell role="SCHOOL_ADMIN" activeHref="/dashboard">
        {error ? <p style={{ color: DANGER, fontSize: 14 }}>{error}</p> : null}
        <SkeletonBlocks rows={3} />
      </Shell>
    );
  }

  const kpis: { label: string; value: string; color: string; icon: ReactNode }[] = [
    { label: "Total Students", value: String(bundle.totalStudents), color: PRIMARY, icon: <Users size={22} /> },
    { label: "Total Teachers", value: String(bundle.totalTeachers), color: SUCCESS, icon: <GraduationCap size={22} /> },
    { label: "Total Classes", value: String(bundle.totalClasses), color: "#7C3AED", icon: <School size={22} /> },
    { label: "Fee Collection", value: inr(bundle.feeCollection), color: WARNING, icon: <Wallet size={22} /> },
  ];

  const growthEmpty = bundle.growth.length === 0 || bundle.growth.every((p) => p.count === 0);

  return (
    <Shell role="SCHOOL_ADMIN" activeHref="/dashboard">
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, margin: 0, color: NAVY }}>
          {greeting(new Date())}, {user?.name ?? ""}
        </h1>
        <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 14 }}>
          Here is what is happening at your school today · {bundle.asOf.day}
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
          <SectionTitle>Student Growth</SectionTitle>
          <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>Admissions per month, last 6 months</p>
          {growthEmpty ? (
            <EmptyState icon={<TrendingUp size={22} />} title="No growth data yet" detail="Admissions per month will appear here once students enroll." />
          ) : (
            <GrowthChart growth={bundle.growth} />
          )}
        </Card>
        <Card>
          <SectionTitle>Quick Actions</SectionTitle>
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
        </Card>
      </section>

      <Card>
        <SectionTitle>Recent Activities</SectionTitle>
        {bundle.activities.length === 0 ? (
          <EmptyState
            icon={<Inbox size={22} />}
            title="Nothing yet"
            detail="Notices, homework, exams, and payments will appear here as they happen."
          />
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
      </Card>
    </Shell>
  );
}
