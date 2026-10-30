"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { Building2, ChartNoAxesColumn, CheckCircle2, Hourglass, IndianRupee, PieChart, School } from "lucide-react";
import { Card, EmptyState, SectionTitle, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, h2Style, iconTile, mutedStyle, pill } from "@/lib/theme";
import { isFailure } from "../../../lib/api";

interface OwnerSchoolRow {
  id: string;
  name: string;
  slug: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  createdAt: string;
  users: number;
  students: number;
}

interface AnalyticsPoint {
  month: string;
  schools: number;
}

interface OwnerBundle {
  totalSchools: number;
  activeSchools: number;
  trialPending: number;
  suspendedSchools: number;
  totalRevenue: string;
  revenueByMethod: { method: string; total: string }[];
  revenueTrend: { month: string; total: string }[];
  schools: OwnerSchoolRow[];
  analytics: AnalyticsPoint[];
  plans: { plan: string; schools: number }[];
  asOf: { month: string };
}

interface ApiError {
  error: { code: string; message: string };
}

// Platform Owner board (§7 Phase 1 #9, §8.3 + sequencing note): shared Shell
// with the canonical owner nav (§8.4 — destinations render as dimmed text +
// "Soon" until their pages exist), 4 KPI cards, searchable Schools table,
// Platform Analytics chart, Subscription Plans panel. Revenue and plans
// render live from paid invoices + the plan mirror (Chunk 2); test/manual
// payments are labelled as such on the invoice rows (§16.1).

const PLAN_COLORS = [colors.primary, colors.success, colors.warning, colors.accent, colors.danger, colors.muted];

function subscriptionPillStyle(status: string): CSSProperties {
  if (status === "ACTIVE") {
    return pill(colors.success, colors.successTint);
  }
  if (status === "SUSPENDED") {
    return pill(colors.danger, colors.dangerTint);
  }
  return pill(colors.warning, colors.warningTint);
}

// Table rows lift softly on hover (same motion language as DataTable rows).
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
  return `${names[(month ?? 1) - 1] ?? ""} ${String(year ?? "").slice(2)}`;
}

function inr(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return `₹${amount}`;
  }
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// TEST/MANUAL split (§16.1): RAZORPAY legs are online test-mode captures,
// MANUAL legs owner-marked. Any other method value (hand-edited rows only)
// prints verbatim — never invented into a channel, never dropped from it.
function revenueSplitText(legs: { method: string; total: string }[]): string {
  const leg = (method: string): string => {
    const found = legs.find((l) => l.method === method);
    return inr(found?.total ?? "0.00");
  };
  const parts = [`MANUAL ${leg("MANUAL")}`, `TEST ${leg("RAZORPAY")}`];
  for (const extra of legs) {
    if (extra.method !== "MANUAL" && extra.method !== "RAZORPAY") {
      parts.push(`${extra.method} ${inr(extra.total)}`);
    }
  }
  return parts.join(" · ");
}

// Monthly bars, shared by both owner charts (signups + revenue) — one grid,
// one month axis, values formatted by the caller. The admin Phase-3 screens
// keep their own inline charts (different data shapes, stable and e2e-pinned;
// churning them for visual sameness would risk tested screens for nothing).
function MonthBars({
  points,
  formatValue,
  ariaLabel,
  barColor,
}: {
  points: { month: string; value: number }[];
  formatValue: (n: number) => string;
  ariaLabel: string;
  barColor: string;
}): ReactNode {
  const width = 600;
  const height = 220;
  const padLeft = 36;
  const padRight = 54;
  const padBottom = 28;
  const padTop = 28;
  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? (width - padLeft - padRight) / (points.length - 1) : 0;
  const barW = Math.min(48, Math.max(12, stepX * 0.5));
  return (
    <div className="sf-chart-scroll">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} className="sf-chart" role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id="ownerBarFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={barColor} stopOpacity="1" />
            <stop offset="100%" stopColor={barColor} stopOpacity="0.55" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => {
          const t = Math.round(max * f);
          const y = padTop + (height - padTop - padBottom) * (1 - t / max);
          return (
            <g key={t}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke={colors.lineSoft} strokeWidth="1" />
              <text x={padLeft - 6} y={y + 4} textAnchor="end" fontSize="11" fill={colors.muted}>
                {t >= 1000 ? `${(t / 1000).toFixed(1)}K` : String(Math.round(t))}
              </text>
            </g>
          );
        })}
        {points.map((p, i) => {
          const barH = (height - padTop - padBottom) * (p.value / max);
          const x = padLeft + i * stepX - barW / 2;
          const y = height - padBottom - barH;
          return (
            <g key={p.month}>
              <rect x={x} y={y} width={barW} height={Math.max(barH, 2)} rx="8" fill="url(#ownerBarFill)" className="sf-chart-bar" style={{ animationDelay: `${i * 70}ms` }} />
              <text x={padLeft + i * stepX} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill={colors.ink}>
                {formatValue(p.value)}
              </text>
              <text x={padLeft + i * stepX} y={height - 8} textAnchor="middle" fontSize="11" fill={colors.muted}>
                {monthLabel(p.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PlansDonut({ plans }: { plans: { plan: string; schools: number }[] }): ReactNode {
  if (plans.length === 0) {
    return (
      <EmptyState
        icon={<PieChart size={22} />}
        title="No plan data yet"
        detail="Schools on paid plans appear here once billing assigns them."
      />
    );
  }
  const size = 180;
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const total = plans.reduce((sum, p) => sum + p.schools, 0);
  if (total <= 0) {
    return (
      <EmptyState
        icon={<PieChart size={22} />}
        title="No plan data yet"
        detail="Schools on paid plans appear here once billing assigns them."
      />
    );
  }
  let offset = 0;
  const segments = plans.map((slice, index) => {
    const fraction = slice.schools / total;
    const color = PLAN_COLORS[index % PLAN_COLORS.length] ?? colors.muted;
    const segment = { ...slice, color, dash: fraction * circumference, offset };
    offset += fraction * circumference;
    return segment;
  });
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="sf-chart" role="img" aria-label="Schools by subscription plan">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={colors.lineSoft} strokeWidth="24" />
        {segments.map((segment, segIndex) =>
          segment.dash > 0 ? (
            <circle
              key={segment.plan}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth="24"
              strokeDasharray={`${Math.max(segment.dash - 3, 1)} ${circumference - segment.dash + 3}`}
              strokeDashoffset={-segment.offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="sf-chart-seg"
              style={{ animationDelay: `${segIndex * 120}ms` }}
            />
          ) : null,
        )}
      </svg>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8, fontSize: 13 }}>
        {segments.map((segment) => (
          <li key={segment.plan} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: segment.color, flexShrink: 0 }} />
            <span style={{ color: colors.ink, textTransform: "capitalize" }}>
              {segment.plan.toLowerCase()} · {segment.schools}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function OwnerDashboardPage() {
  const { token, user, ready, apiFetch } = useAuth();
  const [bundle, setBundle] = useState<OwnerBundle | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready || !token) {
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const dashRes = await apiFetch(`/api/v1/platform/dashboard`);
        const dashBody = (await dashRes.json()) as { data: { dashboard: OwnerBundle } } | ApiError;
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
  }, [ready, token, apiFetch]);

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
        <p style={{ color: colors.muted, margin: "0 0 20px" }}>Sign in to view the platform dashboard.</p>
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

  if (user && user.role !== "PLATFORM_OWNER") {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Platform Dashboard</h1>
        <p style={{ color: colors.danger, fontSize: 14 }}>This board is for the platform owner — your account holds a different role.</p>
      </main>
    );
  }

  if (loading || !bundle) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/dashboard/owner">
        {error ? <p style={{ color: colors.danger, fontSize: 14 }}>{error}</p> : null}
        <SkeletonBlocks rows={3} />
      </Shell>
    );
  }

  const query = search.trim().toLowerCase();
  const schools =
    query.length === 0
      ? bundle.schools
      : bundle.schools.filter(
          (school) => school.name.toLowerCase().includes(query) || school.slug.toLowerCase().includes(query),
        );

  const kpis: { label: string; value: string; sub?: string; color: string; tint: string; icon: ReactNode }[] = [
    { label: "Total Schools", value: String(bundle.totalSchools), color: colors.primary, tint: colors.primaryGhost, icon: <School size={22} /> },
    { label: "Active Schools", value: String(bundle.activeSchools), color: colors.success, tint: colors.successTint, icon: <CheckCircle2 size={22} /> },
    { label: "Trial / Pending", value: String(bundle.trialPending), color: colors.warning, tint: colors.warningTint, icon: <Hourglass size={22} /> },
    {
      label: "Total Revenue",
      value: inr(bundle.totalRevenue),
      ...(bundle.totalRevenue === "0.00" ? { sub: "No paid invoices yet" } : { sub: revenueSplitText(bundle.revenueByMethod) }),
      color: colors.muted,
      tint: colors.lineSoft,
      icon: <IndianRupee size={22} />,
    },
  ];

  const analyticsEmpty = bundle.analytics.length === 0 || bundle.analytics.every((p) => p.schools === 0);
  const revenueEmpty = bundle.revenueTrend.length === 0 || bundle.revenueTrend.every((p) => Number(p.total) <= 0);

  return (
    <Shell role="PLATFORM_OWNER" activeHref="/dashboard/owner">
      <header style={{ marginBottom: 24 }}>
        <h1 style={h1Style}>
          {greeting(new Date())}, {user?.name ?? ""}
        </h1>
        <p style={{ ...mutedStyle, margin: "4px 0 0" }}>
          The whole platform at a glance · {bundle.asOf.month}
        </p>
      </header>

      <section className="sf-grid-kpi" style={{ marginBottom: 20 }}>
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: colors.muted }}>{kpi.label}</span>
              <span style={iconTile(kpi.color, kpi.tint)}>{kpi.icon}</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: colors.ink }}>{kpi.value}</div>
            {"sub" in kpi && kpi.sub ? <div style={{ fontSize: 12, color: colors.muted, marginTop: 8 }}>{kpi.sub}</div> : null}
          </Card>
        ))}
      </section>

      <Card>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <h2 style={{ ...h2Style, margin: 0, flex: 1 }}>Schools</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or slug…"
            aria-label="Search schools"
            className="sf-input"
            style={{ width: "auto", minWidth: 220 }}
          />
        </div>
        {schools.length === 0 ? (
          <EmptyState icon={<Building2 size={22} />} title="No schools found" detail={query ? `No schools match "${search}".` : "No schools registered yet."} />
        ) : (
          <div className="sf-table-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["School", "Slug", "Status", "Users", "Students", "Joined"].map((header) => (
                    <th
                      key={header}
                      style={{
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
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schools.map((school) => (
                  <tr
                    key={school.id}
                    style={{ transition: "background 140ms cubic-bezier(.22,1,.36,1)" }}
                    onMouseEnter={rowHoverIn}
                    onMouseLeave={rowHoverOut}
                  >
                    <td style={{ padding: "12px 14px", fontSize: 14, borderBottom: `1px solid ${colors.lineSoft}`, color: colors.ink, fontWeight: 600 }}>{school.name}</td>
                    <td style={{ padding: "12px 14px", fontSize: 13, borderBottom: `1px solid ${colors.lineSoft}`, color: colors.muted }}>{school.slug}</td>
                    <td style={{ padding: "12px 14px", fontSize: 14, borderBottom: `1px solid ${colors.lineSoft}` }}>
                      <span style={subscriptionPillStyle(school.subscriptionStatus)}>
                        {school.subscriptionStatus}
                      </span>
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 14, borderBottom: `1px solid ${colors.lineSoft}` }}>{school.users}</td>
                    <td style={{ padding: "12px 14px", fontSize: 14, borderBottom: `1px solid ${colors.lineSoft}` }}>{school.students}</td>
                    <td style={{ padding: "12px 14px", fontSize: 13, borderBottom: `1px solid ${colors.lineSoft}`, color: colors.muted }}>
                      {new Date(school.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <section className="sf-grid-2-1" style={{ marginTop: 20 }}>
        <Card>
          <SectionTitle>Platform Analytics</SectionTitle>
          <p style={{ fontSize: 13, color: colors.muted, margin: "0 0 12px" }}>New schools per month, last 6 months</p>
          {analyticsEmpty ? (
            <EmptyState icon={<ChartNoAxesColumn size={22} />} title="No analytics yet" detail="New schools per month will appear here once schools join." />
          ) : (
            <MonthBars
              points={bundle.analytics.map((p) => ({ month: p.month, value: p.schools }))}
              formatValue={(n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(Math.round(n)))}
              ariaLabel="New schools per month"
              barColor={colors.warning}
            />
          )}
        </Card>
        <Card>
          <SectionTitle>Subscription Plans</SectionTitle>
          <PlansDonut plans={bundle.plans} />
          <div data-testid="status-mix" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <span style={pill(colors.warning, colors.warningTint)}>Trial {bundle.trialPending}</span>
            <span style={pill(colors.success, colors.successTint)}>Active {bundle.activeSchools}</span>
            <span style={pill(colors.danger, colors.dangerTint)}>Suspended {bundle.suspendedSchools}</span>
          </div>
        </Card>
      </section>

      <section style={{ marginTop: 20 }}>
        <Card>
          <SectionTitle>Revenue trend</SectionTitle>
          <p style={{ fontSize: 13, color: colors.muted, margin: "0 0 12px" }}>Paid invoices by month, last 6 months</p>
          {revenueEmpty ? (
            <EmptyState icon={<IndianRupee size={22} />} title="No revenue yet" detail="Paid subscription invoices will appear here month by month." />
          ) : (
            <MonthBars
              points={bundle.revenueTrend.map((p) => ({ month: p.month, value: Number(p.total) }))}
              formatValue={(n) => (n >= 1000 ? `₹${(n / 1000).toFixed(1)}K` : `₹${Math.round(n)}`)}
              ariaLabel="Paid subscription revenue per month"
              barColor={colors.success}
            />
          )}
        </Card>
      </section>
    </Shell>
  );
}
