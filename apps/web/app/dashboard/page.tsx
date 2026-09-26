"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { GraduationCap, Inbox, School, TrendingUp, Users, Wallet } from "lucide-react";
import { Card, EmptyState, SectionTitle, Shell, SkeletonBlocks } from "../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, iconTile, mutedStyle } from "@/lib/theme";
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

const KIND_TONES: Record<ActivityItem["kind"], { tone: string; tint: string }> = {
  notice: { tone: colors.primary, tint: colors.primaryGhost },
  homework: { tone: colors.warning, tint: colors.warningTint },
  exam: { tone: colors.accent, tint: colors.accentTint },
  payment: { tone: colors.success, tint: colors.successTint },
};

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
          <stop offset="0%" stopColor={colors.primary} stopOpacity="0.28" />
          <stop offset="100%" stopColor={colors.primary} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => {
        const y = padTop + (height - padTop - padBottom) * (1 - t / max);
        return (
          <g key={t}>
            <line x1={padLeft} y1={y} x2={width - 8} y2={y} stroke={colors.lineSoft} strokeWidth="1" />
            <text x={padLeft - 6} y={y + 4} textAnchor="end" fontSize="11" fill={colors.muted}>
              {t}
            </text>
          </g>
        );
      })}
      <path d={area} fill="url(#growthFill)" />
      <path d={line} fill="none" stroke={colors.primary} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p) => (
        <g key={p.month}>
          <circle cx={p.x} cy={p.y} r="4" fill={colors.card} stroke={colors.primary} strokeWidth="2.5" />
          <text x={p.x} y={height - 8} textAnchor="middle" fontSize="11" fill={colors.muted}>
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
        <p style={{ color: colors.muted, margin: "0 0 20px" }}>Sign in to view the school admin dashboard.</p>
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
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>School Admin Dashboard</h1>
        <p style={{ color: colors.danger, fontSize: 14 }}>No school on this account</p>
      </main>
    );
  }

  if (loading || !bundle) {
    return (
      <Shell role="SCHOOL_ADMIN" activeHref="/dashboard">
        {error ? <p style={{ color: colors.danger, fontSize: 14 }}>{error}</p> : null}
        <SkeletonBlocks rows={3} />
      </Shell>
    );
  }

  const kpis: { label: string; value: string; color: string; tint: string; icon: ReactNode }[] = [
    { label: "Total Students", value: String(bundle.totalStudents), color: colors.primary, tint: colors.primaryGhost, icon: <Users size={22} /> },
    { label: "Total Teachers", value: String(bundle.totalTeachers), color: colors.success, tint: colors.successTint, icon: <GraduationCap size={22} /> },
    { label: "Total Classes", value: String(bundle.totalClasses), color: colors.accent, tint: colors.accentTint, icon: <School size={22} /> },
    { label: "Fee Collection", value: inr(bundle.feeCollection), color: colors.warning, tint: colors.warningTint, icon: <Wallet size={22} /> },
  ];

  const growthEmpty = bundle.growth.length === 0 || bundle.growth.every((p) => p.count === 0);

  return (
    <Shell role="SCHOOL_ADMIN" activeHref="/dashboard">
      <header style={{ marginBottom: 24 }}>
        <h1 style={h1Style}>
          {greeting(new Date())}, {user?.name ?? ""}
        </h1>
        <p style={{ ...mutedStyle, margin: "4px 0 0" }}>
          Here is what is happening at your school today · {bundle.asOf.day}
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
          <SectionTitle>Student Growth</SectionTitle>
          <p style={{ fontSize: 13, color: colors.muted, margin: "0 0 12px" }}>Admissions per month, last 6 months</p>
          {growthEmpty ? (
            <EmptyState icon={<TrendingUp size={22} />} title="No growth data yet" detail="Admissions per month will appear here once students enroll." />
          ) : (
            <GrowthChart growth={bundle.growth} />
          )}
        </Card>
        <Card>
          <SectionTitle>Quick Actions</SectionTitle>
          <div style={{ display: "grid", gap: 12 }}>
            {[
              { label: "Admit Student", href: "/students/new" },
              { label: "Mark Attendance", href: "/attendance/mark" },
              { label: "Collect Fee", href: "/fees" },
              { label: "Post Notice", href: "/notices" },
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
            {bundle.activities.map((activity, index) => {
              const kind = KIND_TONES[activity.kind];
              return (
                <li
                  key={`${activity.kind}-${activity.at}-${index}`}
                  onMouseEnter={rowHoverIn}
                  onMouseLeave={rowHoverOut}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    padding: "12px 8px",
                    margin: "0 -8px",
                    borderRadius: 10,
                    transition: "background 140ms cubic-bezier(.22,1,.36,1)",
                    borderTop: index === 0 ? 0 : `1px solid ${colors.lineSoft}`,
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      background: kind.tint,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 3,
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: kind.tone }} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colors.ink }}>{activity.title}</div>
                    <div style={{ fontSize: 12, color: colors.muted, textTransform: "capitalize" }}>
                      {activity.kind} · {new Date(activity.at).toLocaleString()}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Shell>
  );
}
