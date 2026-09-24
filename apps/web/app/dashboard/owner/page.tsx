"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { Building2, ChartNoAxesColumn, CheckCircle2, Hourglass, IndianRupee, PieChart, School } from "lucide-react";
import { Card, EmptyState, SectionTitle, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";

interface Me {
  id: string;
  name: string;
  email: string;
  schoolId: string | null;
  role: string;
}

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

const NAVY = "#0F172A";
const OWNER_AMBER = "#F59E0B";
const PRIMARY = "#2563EB";
const SUCCESS = "#059669";
const WARNING = "#D97706";
const DANGER = "#DC2626";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: SUCCESS,
  TRIAL: WARNING,
  SUSPENDED: DANGER,
};

const PLAN_COLORS = ["#2563EB", "#059669", "#F59E0B", "#7C3AED", "#DB2777", "#0D9488"];

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
            <line x1={padLeft} y1={y} x2={width - 8} y2={y} stroke="#E2E8F0" strokeWidth="1" />
            <text x={padLeft - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#64748B">
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
            <rect x={x} y={y} width={barW} height={Math.max(barH, 2)} rx="4" fill={OWNER_AMBER} />
            <text x={padLeft + i * stepX} y={y - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill={NAVY}>
              {p.schools}
            </text>
            <text x={padLeft + i * stepX} y={height - 8} textAnchor="middle" fontSize="11" fill="#64748B">
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
    const color = PLAN_COLORS[index % PLAN_COLORS.length] ?? "#64748B";
    const segment = { ...slice, color, dash: fraction * circumference, offset };
    offset += fraction * circumference;
    return segment;
  });
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Schools by subscription plan">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F1F5F9" strokeWidth="24" />
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
            <span style={{ color: NAVY, textTransform: "capitalize" }}>
              {segment.plan.toLowerCase()} · {segment.schools}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function OwnerDashboardPage() {
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [bundle, setBundle] = useState<OwnerBundle | null>(null);
  const [search, setSearch] = useState("");
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
          fetch(`${api}/api/v1/platform/dashboard`, { headers: auth }),
        ]);
        const meBody = (await meRes.json()) as { data: { user: Me } } | ApiError;
        if (isFailure(meRes, meBody)) {
          throw new Error(meBody.error?.message ?? "Sign-in failed.");
        }
        if (meBody.data.user.role !== "PLATFORM_OWNER") {
          throw new Error("This board is for the platform owner — your account holds a different role.");
        }
        const dashBody = (await dashRes.json()) as { data: { dashboard: OwnerBundle } } | ApiError;
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
    [api, token],
  );

  if (!connected || !me || !bundle) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Platform Dashboard</h1>
        <p style={{ color: "#64748B", margin: "0 0 20px" }}>Paste a platform-owner token to load the live board (no school slug — owners sign in without one).</p>
        <form onSubmit={connect} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
            Owner token
            <input value={token} onChange={(e) => setToken(e.target.value)} required style={{ padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }} />
          </label>
          <button type="submit" disabled={loading} style={{ padding: 12, borderRadius: 10, border: 0, background: NAVY, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
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

  const query = search.trim().toLowerCase();
  const schools =
    query.length === 0
      ? bundle.schools
      : bundle.schools.filter(
          (school) => school.name.toLowerCase().includes(query) || school.slug.toLowerCase().includes(query),
        );

  const kpis: { label: string; value: string; sub?: string; color: string; icon: ReactNode }[] = [
    { label: "Total Schools", value: String(bundle.totalSchools), color: PRIMARY, icon: <School size={22} /> },
    { label: "Active Schools", value: String(bundle.activeSchools), color: SUCCESS, icon: <CheckCircle2 size={22} /> },
    { label: "Trial / Pending", value: String(bundle.trialPending), color: WARNING, icon: <Hourglass size={22} /> },
    {
      label: "Total Revenue",
      value: inr(bundle.totalRevenue),
      ...(bundle.totalRevenue === "0.00" ? { sub: "Billing lands in Phase 4" } : {}),
      color: "#64748B",
      icon: <IndianRupee size={22} />,
    },
  ];

  const analyticsEmpty = bundle.analytics.length === 0 || bundle.analytics.every((p) => p.schools === 0);

  return (
    <Shell role="PLATFORM_OWNER" activeHref="/dashboard/owner">
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, margin: 0, color: NAVY }}>
          {greeting(new Date())}, {me.name}
        </h1>
        <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 14 }}>
          The whole platform at a glance · {bundle.asOf.month}
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
            {"sub" in kpi && kpi.sub ? <div style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>{kpi.sub}</div> : null}
          </Card>
        ))}
      </section>

      <Card>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 16, margin: 0, color: NAVY, flex: 1 }}>Schools</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or slug…"
            aria-label="Search schools"
            style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #CBD5E1", fontSize: 14, minWidth: 220 }}
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
                    <th key={header} style={{ textAlign: "left", padding: "10px 12px", color: PRIMARY, fontSize: 13, borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" }}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schools.map((school) => (
                  <tr key={school.id}>
                    <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9", color: NAVY, fontWeight: 600 }}>{school.name}</td>
                    <td style={{ padding: "10px 12px", fontSize: 13, borderBottom: "1px solid #F1F5F9", color: "#64748B" }}>{school.slug}</td>
                    <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9" }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          borderRadius: 999,
                          padding: "3px 10px",
                          background: school.subscriptionStatus === "ACTIVE" ? "#D1FAE5" : school.subscriptionStatus === "SUSPENDED" ? "#FEE2E2" : "#FEF3C7",
                          color: STATUS_COLORS[school.subscriptionStatus] ?? "#64748B",
                        }}
                      >
                        {school.subscriptionStatus}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9" }}>{school.users}</td>
                    <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9" }}>{school.students}</td>
                    <td style={{ padding: "10px 12px", fontSize: 13, borderBottom: "1px solid #F1F5F9", color: "#64748B" }}>
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
          <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>New schools per month, last 6 months</p>
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
