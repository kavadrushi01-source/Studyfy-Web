"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { SignInLink } from "@/components/ui/sign-in-gate";
import { AlertTriangle, Clock, Inbox, IndianRupee, PieChart, TrendingUp, Users } from "lucide-react";
import { Card, EmptyState, SectionTitle, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, iconTile, mutedStyle, pill } from "@/lib/theme";
import { isFailure } from "../../../lib/api";

interface TrendPoint {
  month: string;
  collected: string;
}

interface StatusSlice {
  status: string;
  count: number;
  amount: string;
}

interface TransactionItem {
  id: string;
  studentName: string;
  amount: string;
  method: string;
  paidAt: string;
  invoiceStatus: string;
}

interface AccountantBundle {
  totalCollected: string;
  pendingFees: string;
  overdueFees: string;
  totalStudents: number;
  trend: TrendPoint[];
  byStatus: StatusSlice[];
  recentTransactions: TransactionItem[];
  asOf: { day: string; month: string };
}

interface ApiError {
  error: { code: string; message: string };
}

// Accountant board (§7 Phase 1 #9, §8.3): shared Shell with the canonical
// accountant nav (§8.4 — Invoices / Payments & Receipts point at /fees until
// distinct pages exist), greeting, 4 KPI cards (Total Collected, Pending
// Fees, Overdue Fees, Total Students), Fee Collection Trend chart, Payment
// Status donut, Recent Transactions table. Same rules as the other boards:
// every figure from GET .../dashboard/accountant, zeros are zeros (§8.1),
// token-paste until login, skeleton loading (§8.5). Charts are hand-rolled
// SVG — no chart dependency, no audit surface.

const STATUS_COLORS: Record<string, string> = {
  PAID: colors.success,
  PARTIAL: colors.primary,
  PENDING: colors.warning,
  OVERDUE: colors.danger,
  REFUNDED: colors.muted,
};

function invoicePillStyle(status: string): CSSProperties {
  if (status === "PAID") {
    return pill(colors.success, colors.successTint);
  }
  if (status === "OVERDUE") {
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

function TrendChart({ trend }: { trend: TrendPoint[] }): ReactNode {
  const width = 600;
  const height = 220;
  const padLeft = 64;
  const padBottom = 28;
  const padTop = 12;
  const values = trend.map((p) => Number(p.collected));
  const max = Math.max(1, ...values);
  const stepX = trend.length > 1 ? (width - padLeft - 8) / (trend.length - 1) : 0;
  const points = trend.map((p, i) => ({
    x: padLeft + i * stepX,
    y: padTop + (height - padTop - padBottom) * (1 - Number(p.collected) / max),
    ...p,
  }));
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${(points[points.length - 1]?.x ?? 0).toFixed(1)},${height - padBottom} L${padLeft},${height - padBottom} Z`;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  return (
    <div className="sf-chart-scroll">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} className="sf-chart" role="img" aria-label="Fee collection per month">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.accent} stopOpacity="0.28" />
            <stop offset="100%" stopColor={colors.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => {
          const y = padTop + (height - padTop - padBottom) * (1 - t / max);
          return (
            <g key={t}>
              <line x1={padLeft} y1={y} x2={width - 8} y2={y} stroke={colors.lineSoft} strokeWidth="1" />
              <text x={padLeft - 6} y={y + 4} textAnchor="end" fontSize="11" fill={colors.muted}>
                ₹{(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}k
              </text>
            </g>
          );
        })}
        <path d={area} fill="url(#trendFill)" />
        <path d={line} fill="none" stroke={colors.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className="sf-chart-line sf-chart-draw" />
        {points.map((p) => (
          <g key={p.month}>
            <circle cx={p.x} cy={p.y} r="4" fill={colors.card} stroke={colors.accent} strokeWidth="2.5" className="sf-chart-dot" />
            <text x={p.x} y={height - 8} textAnchor="middle" fontSize="11" fill={colors.muted}>
              {monthLabel(p.month)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function StatusDonut({ slices }: { slices: StatusSlice[] }): ReactNode {
  const size = 180;
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, s) => sum + Number(s.amount), 0);
  if (slices.length === 0 || total <= 0) {
    return (
      <EmptyState icon={<PieChart size={22} />} title="No invoices yet" detail="Invoice status breakdown will appear here once fees are raised." />
    );
  }
  let offset = 0;
  const segments = slices.map((slice) => {
    const fraction = total > 0 ? Number(slice.amount) / total : 0;
    const segment = { ...slice, dash: fraction * circumference, offset };
    offset += fraction * circumference;
    return segment;
  });
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="sf-chart" role="img" aria-label="Invoice amounts by status">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={colors.lineSoft} strokeWidth="24" />
        {segments.map((segment, segIndex) =>
          segment.dash > 0 ? (
            <circle
              key={segment.status}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={STATUS_COLORS[segment.status] ?? colors.muted}
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
        {slices.map((slice) => (
          <li key={slice.status} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: STATUS_COLORS[slice.status] ?? colors.muted, flexShrink: 0 }} />
            <span style={{ color: colors.ink, textTransform: "capitalize" }}>
              {slice.status.toLowerCase()} · {slice.count}
            </span>
            <span style={{ color: colors.muted }}>{inr(slice.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AccountantDashboardPage() {
  const { token, schoolId, user, ready, apiFetch } = useAuth();
  const [bundle, setBundle] = useState<AccountantBundle | null>(null);
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
        const dashRes = await apiFetch(`/api/v1/schools/${schoolId}/dashboard/accountant`);
        const dashBody = (await dashRes.json()) as { data: { dashboard: AccountantBundle } } | ApiError;
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
        <p style={{ color: colors.muted, margin: "0 0 20px" }}>Sign in to view the accountant board.</p>
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
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Accountant Dashboard</h1>
        <p style={{ color: colors.danger, fontSize: 14 }}>No school on this account</p>
      </main>
    );
  }

  if (user && user.role !== "ACCOUNTANT") {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Accountant Dashboard</h1>
        <p style={{ color: colors.danger, fontSize: 14 }}>This board is for accountants — your account holds a different role.</p>
      </main>
    );
  }

  if (loading || !bundle) {
    return (
      <Shell role="ACCOUNTANT" activeHref="/dashboard/accountant">
        {error ? <p style={{ color: colors.danger, fontSize: 14 }}>{error}</p> : null}
        <SkeletonBlocks rows={3} />
      </Shell>
    );
  }

  const kpis: { label: string; value: string; color: string; tint: string; icon: ReactNode }[] = [
    { label: "Total Collected", value: inr(bundle.totalCollected), color: colors.success, tint: colors.successTint, icon: <IndianRupee size={22} /> },
    { label: "Pending Fees", value: inr(bundle.pendingFees), color: colors.warning, tint: colors.warningTint, icon: <Clock size={22} /> },
    { label: "Overdue Fees", value: inr(bundle.overdueFees), color: colors.danger, tint: colors.dangerTint, icon: <AlertTriangle size={22} /> },
    { label: "Total Students", value: String(bundle.totalStudents), color: colors.primary, tint: colors.primaryGhost, icon: <Users size={22} /> },
  ];

  const trendEmpty = bundle.trend.length === 0 || bundle.trend.every((p) => Number(p.collected) === 0);

  return (
    <Shell role="ACCOUNTANT" activeHref="/dashboard/accountant">
      <header style={{ marginBottom: 24 }}>
        <h1 style={h1Style}>
          {greeting(new Date())}, {user?.name ?? ""}
        </h1>
        <p style={{ ...mutedStyle, margin: "4px 0 0" }}>
          Fee collection at a glance · {bundle.asOf.day}
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
          <SectionTitle>Fee Collection Trend</SectionTitle>
          <p style={{ fontSize: 13, color: colors.muted, margin: "0 0 12px" }}>Collected per month, last 6 months</p>
          {trendEmpty ? (
            <EmptyState icon={<TrendingUp size={22} />} title="No collection data yet" detail="Collected amounts per month will appear here once fees are paid." />
          ) : (
            <TrendChart trend={bundle.trend} />
          )}
        </Card>
        <Card>
          <SectionTitle>Payment Status</SectionTitle>
          <StatusDonut slices={bundle.byStatus} />
        </Card>
      </section>

      <Card>
        <SectionTitle>Recent Transactions</SectionTitle>
        {bundle.recentTransactions.length === 0 ? (
          <EmptyState icon={<Inbox size={22} />} title="No payments yet" detail="No payments recorded yet — collections will appear here." />
        ) : (
          <div className="sf-table-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Student", "Amount", "Method", "Paid", "Invoice"].map((header) => (
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
                {bundle.recentTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    style={{ transition: "background 140ms cubic-bezier(.22,1,.36,1)" }}
                    onMouseEnter={rowHoverIn}
                    onMouseLeave={rowHoverOut}
                  >
                    <td style={{ padding: "12px 14px", fontSize: 14, borderBottom: `1px solid ${colors.lineSoft}`, color: colors.inkSoft }}>{tx.studentName}</td>
                    <td style={{ padding: "12px 14px", fontSize: 14, borderBottom: `1px solid ${colors.lineSoft}`, fontWeight: 700, color: colors.ink }}>{inr(tx.amount)}</td>
                    <td style={{ padding: "12px 14px", fontSize: 14, borderBottom: `1px solid ${colors.lineSoft}`, color: colors.muted }}>{tx.method}</td>
                    <td style={{ padding: "12px 14px", fontSize: 13, borderBottom: `1px solid ${colors.lineSoft}`, color: colors.muted }}>
                      {new Date(tx.paidAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "12px 14px", fontSize: 14, borderBottom: `1px solid ${colors.lineSoft}` }}>
                      <span style={invoicePillStyle(tx.invoiceStatus)}>
                        {tx.invoiceStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Shell>
  );
}
