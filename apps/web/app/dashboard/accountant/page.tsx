"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, Inbox, IndianRupee, PieChart, TrendingUp, Users } from "lucide-react";
import { Card, EmptyState, SectionTitle, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
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

const NAVY = "#0F172A";
const ACCOUNTANT_PURPLE = "#7C3AED";
const PRIMARY = "#2563EB";
const SUCCESS = "#059669";
const WARNING = "#D97706";
const DANGER = "#DC2626";

const STATUS_COLORS: Record<string, string> = {
  PAID: SUCCESS,
  PARTIAL: PRIMARY,
  PENDING: WARNING,
  OVERDUE: DANGER,
  REFUNDED: "#64748B",
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
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Fee collection per month">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCOUNTANT_PURPLE} stopOpacity="0.25" />
          <stop offset="100%" stopColor={ACCOUNTANT_PURPLE} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => {
        const y = padTop + (height - padTop - padBottom) * (1 - t / max);
        return (
          <g key={t}>
            <line x1={padLeft} y1={y} x2={width - 8} y2={y} stroke="#E2E8F0" strokeWidth="1" />
            <text x={padLeft - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#64748B">
              ₹{(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}k
            </text>
          </g>
        );
      })}
      <path d={area} fill="url(#trendFill)" />
      <path d={line} fill="none" stroke={ACCOUNTANT_PURPLE} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p) => (
        <g key={p.month}>
          <circle cx={p.x} cy={p.y} r="4" fill="#fff" stroke={ACCOUNTANT_PURPLE} strokeWidth="2.5" />
          <text x={p.x} y={height - 8} textAnchor="middle" fontSize="11" fill="#64748B">
            {monthLabel(p.month)}
          </text>
        </g>
      ))}
    </svg>
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
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Invoice amounts by status">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F1F5F9" strokeWidth="24" />
        {segments.map((segment) =>
          segment.dash > 0 ? (
            <circle
              key={segment.status}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={STATUS_COLORS[segment.status] ?? "#64748B"}
              strokeWidth="24"
              strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
              strokeDashoffset={-segment.offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ) : null,
        )}
      </svg>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8, fontSize: 13 }}>
        {slices.map((slice) => (
          <li key={slice.status} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: STATUS_COLORS[slice.status] ?? "#64748B", flexShrink: 0 }} />
            <span style={{ color: NAVY, textTransform: "capitalize" }}>
              {slice.status.toLowerCase()} · {slice.count}
            </span>
            <span style={{ color: "#64748B" }}>{inr(slice.amount)}</span>
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
        <p style={{ color: "#64748B", margin: "0 0 20px" }}>Sign in to view the accountant board.</p>
        <Link
          href="/login"
          style={{ display: "inline-block", padding: "12px 24px", borderRadius: 10, background: ACCOUNTANT_PURPLE, color: "#fff", fontWeight: 600, textDecoration: "none" }}
        >
          Go to sign in
        </Link>
      </main>
    );
  }

  if (!schoolId) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Accountant Dashboard</h1>
        <p style={{ color: DANGER, fontSize: 14 }}>No school on this account</p>
      </main>
    );
  }

  if (user && user.role !== "ACCOUNTANT") {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Accountant Dashboard</h1>
        <p style={{ color: DANGER, fontSize: 14 }}>This board is for accountants — your account holds a different role.</p>
      </main>
    );
  }

  if (loading || !bundle) {
    return (
      <Shell role="ACCOUNTANT" activeHref="/dashboard/accountant">
        {error ? <p style={{ color: DANGER, fontSize: 14 }}>{error}</p> : null}
        <SkeletonBlocks rows={3} />
      </Shell>
    );
  }

  const kpis: { label: string; value: string; color: string; icon: ReactNode }[] = [
    { label: "Total Collected", value: inr(bundle.totalCollected), color: SUCCESS, icon: <IndianRupee size={22} /> },
    { label: "Pending Fees", value: inr(bundle.pendingFees), color: WARNING, icon: <Clock size={22} /> },
    { label: "Overdue Fees", value: inr(bundle.overdueFees), color: DANGER, icon: <AlertTriangle size={22} /> },
    { label: "Total Students", value: String(bundle.totalStudents), color: PRIMARY, icon: <Users size={22} /> },
  ];

  const trendEmpty = bundle.trend.length === 0 || bundle.trend.every((p) => Number(p.collected) === 0);

  return (
    <Shell role="ACCOUNTANT" activeHref="/dashboard/accountant">
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, margin: 0, color: NAVY }}>
          {greeting(new Date())}, {user?.name ?? ""}
        </h1>
        <p style={{ color: "#64748B", margin: "4px 0 0", fontSize: 14 }}>
          Fee collection at a glance · {bundle.asOf.day}
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
          <SectionTitle>Fee Collection Trend</SectionTitle>
          <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>Collected per month, last 6 months</p>
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
                    <th key={header} style={{ textAlign: "left", padding: "10px 12px", color: PRIMARY, fontSize: 13, borderBottom: "1px solid #E2E8F0", whiteSpace: "nowrap" }}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bundle.recentTransactions.map((tx) => (
                  <tr key={tx.id}>
                    <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9", color: NAVY }}>{tx.studentName}</td>
                    <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9", fontWeight: 600 }}>{inr(tx.amount)}</td>
                    <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9", color: "#64748B" }}>{tx.method}</td>
                    <td style={{ padding: "10px 12px", fontSize: 13, borderBottom: "1px solid #F1F5F9", color: "#64748B" }}>
                      {new Date(tx.paidAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "10px 12px", fontSize: 14, borderBottom: "1px solid #F1F5F9" }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          borderRadius: 999,
                          padding: "3px 10px",
                          background: tx.invoiceStatus === "PAID" ? "#D1FAE5" : tx.invoiceStatus === "OVERDUE" ? "#FEE2E2" : "#FEF3C7",
                          color: tx.invoiceStatus === "PAID" ? SUCCESS : tx.invoiceStatus === "OVERDUE" ? DANGER : WARNING,
                        }}
                      >
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
