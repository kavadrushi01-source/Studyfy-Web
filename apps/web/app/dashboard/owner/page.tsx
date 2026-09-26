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
  totalRevenue: string;
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
// Platform Analytics chart, Subscription Plans panel. Sequencing honesty:
// revenue and plans render live from the API — today that is ₹0.00 / empty,
// with an explicit "Phase 4 billing" note only in that state, never
// projections (§8.1). The schools search filters the returned list
// client-side, which is the honest shape at this scale (tens of schools,
// one 100-row response), not a paged server query pretending at Google
// scale.

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

function AnalyticsChart({ analytics }: { analytics: AnalyticsPoint[] }): ReactNode {
  const width = 600;
  const height = 220;
  const padLeft = 36;
  const padBottom = 28;
  const padTop = 12;
  const max = Math.max(1, ...analytics.map((p) => p.schools));
  const stepX = analytics.length > 1 ? (width - padLeft - 8) / (analytics.length - 1) : 0;
  const barW = Math.min(48, Math.max(12, stepX * 0.5));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="New schools per month">
      {[0, 0.5, 1].map((f) => {
        const t = Math.round(max * f);
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
      {analytics.map((p, i) => {
        const barH = (height - padTop - padBottom) * (p.schools / max);
        const x = padLeft + i * stepX - barW / 2;
        const y = height - padBottom - barH;
        return (
          <g key={p.month}>
            <rect x={x} y={y} width={barW} height={Math.max(barH, 2)} rx="6" fill={colors.warning} />
            <text x={padLeft + i * stepX} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill={colors.ink}>
              {p.schools}
            </text>
            <text x={padLeft + i * stepX} y={height - 8} textAnchor="middle" fontSize="11" fill={colors.muted}>
              {monthLabel(p.month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PlansDonut({ plans }: { plans: { plan: string; schools: number }[] }): ReactNode {
  if (plans.length === 0) {
    return (
      <EmptyState
        icon={<PieChart size={22} />}
        title="No plan data yet"
        detail="No plan data yet — the plan mix renders here once Phase 4 billing exists. Total revenue likewise stays ₹0.00 until then."
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
        detail="No plan data yet — the plan mix renders here once Phase 4 billing exists. Total revenue likewise stays ₹0.00 until then."
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
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Schools by subscription plan">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={colors.lineSoft} strokeWidth="24" />
        {segments.map((segment) =>
          segment.dash > 0 ? (
            <circle
              key={segment.plan}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth="24"
              strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
              strokeDashoffset={-segment.offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
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
      ...(bundle.totalRevenue === "0.00" ? { sub: "Billing lands in Phase 4" } : {}),
      color: colors.muted,
      tint: colors.lineSoft,
      icon: <IndianRupee size={22} />,
    },
  ];

  const analyticsEmpty = bundle.analytics.length === 0 || bundle.analytics.every((p) => p.schools === 0);

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
            <AnalyticsChart analytics={bundle.analytics} />
          )}
        </Card>
        <Card>
          <SectionTitle>Subscription Plans</SectionTitle>
          <PlansDonut plans={bundle.plans} />
        </Card>
      </section>
    </Shell>
  );
}
