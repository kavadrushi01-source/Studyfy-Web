"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { isFailure } from "../../../lib/api";

interface Me {
  id: string;
  name: string;
  email: string;
  schoolId: string | null;
  role: string;
}

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

// Accountant board (§7 Phase 1 #9, §8.3): purple accountant badge, the
// canonical accountant nav (§8.4), greeting, 4 KPI cards (Total Collected,
// Pending Fees, Overdue Fees, Total Students), Fee Collection Trend chart,
// Payment Status donut, Recent Transactions table. Same rules as the other
// boards: every figure from GET .../dashboard/accountant, zeros are zeros
// (§8.1), token-paste until login, skeleton loading (§8.5). Charts are
// hand-rolled SVG — no chart dependency, no audit surface.

const NAVY = "#0F172A";
const ACCOUNTANT_PURPLE = "#7C3AED";
const PRIMARY = "#2563EB";
const CANVAS = "#F8FAFC";
const SUCCESS = "#059669";
const WARNING = "#D97706";
const DANGER = "#DC2626";

const NAV: { label: string; href: string | null }[] = [
  { label: "Dashboard", href: "/dashboard/accountant" },
  { label: "Fees & Payments", href: "/fees" },
  { label: "Invoices", href: "/fees" },
  { label: "Payments & Receipts", href: "/fees" },
  { label: "Collection Reports", href: null },
  { label: "Student Fee Ledger", href: null },
  { label: "Reports & Analytics", href: null },
  { label: "Settings", href: null },
];

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

function Icon({ d }: { d: string }): ReactNode {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
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
        {slices.length === 0 ? <li style={{ color: "#64748B" }}>No invoices yet.</li> : null}
      </ul>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  boxShadow: "0 1px 3px rgba(15,23,42,.08)",
  padding: 20,
};

const skeleton: React.CSSProperties = { height: 64, borderRadius: 14, background: "#F1F5F9", marginBottom: 12 };

export default function AccountantDashboardPage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [bundle, setBundle] = useState<AccountantBundle | null>(null);
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
          fetch(`${api}/api/v1/schools/${schoolId}/dashboard/accountant`, { headers: auth }),
        ]);
        const meBody = (await meRes.json()) as { data: { user: Me } } | ApiError;
        if (isFailure(meRes, meBody)) {
          throw new Error(meBody.error?.message ?? "Sign-in failed.");
        }
        if (meBody.data.user.role !== "ACCOUNTANT") {
          throw new Error("This board is for accountants — your account holds a different role.");
        }
        const dashBody = (await dashRes.json()) as { data: { dashboard: AccountantBundle } } | ApiError;
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
    [api, schoolId, token],
  );

  if (!connected || !me || !bundle) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Accountant Dashboard</h1>
        <p style={{ color: "#64748B", margin: "0 0 20px" }}>Paste a school-id + accountant token to load the live board.</p>
        <form onSubmit={connect} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
            School ID
            <input value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required style={{ padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
            Accountant token
            <input value={token} onChange={(e) => setToken(e.target.value)} required style={{ padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }} />
          </label>
          <button type="submit" disabled={loading} style={{ padding: 12, borderRadius: 10, border: 0, background: ACCOUNTANT_PURPLE, color: "#fff", fontWeight: 600, cursor: "pointer" }}>
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
    { label: "Total Collected", value: inr(bundle.totalCollected), color: SUCCESS, icon: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16V7 M18 12a2 2 0 0 0 0 4h-4a2 2 0 0 1 0-4z" },
    { label: "Pending Fees", value: inr(bundle.pendingFees), color: WARNING, icon: "M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" },
    { label: "Overdue Fees", value: inr(bundle.overdueFees), color: DANGER, icon: "M12 8v4l3 3 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" },
    { label: "Total Students", value: String(bundle.totalStudents), color: PRIMARY, icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif", background: CANVAS }}>
      <aside style={{ width: 248, background: NAVY, color: "#E2E8F0", padding: "20px 14px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 16px" }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: PRIMARY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20 }}>S</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>Studyfy</span>
        </div>
        <div style={{ margin: "0 8px 16px", display: "inline-block", fontSize: 12, fontWeight: 600, background: ACCOUNTANT_PURPLE, color: "#fff", borderRadius: 999, padding: "4px 12px" }}>
          Accountant
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
                  background: item.href === "/dashboard/accountant" ? ACCOUNTANT_PURPLE : "transparent",
                  color: item.href === "/dashboard/accountant" ? "#fff" : "#CBD5E1",
                  fontWeight: item.href === "/dashboard/accountant" ? 600 : 400,
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
            Fee collection at a glance · {bundle.asOf.day}
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
            <h2 style={{ fontSize: 16, margin: "0 0 4px", color: NAVY }}>Fee Collection Trend</h2>
            <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>Collected per month, last 6 months</p>
            <TrendChart trend={bundle.trend} />
          </div>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Payment Status</h2>
            <StatusDonut slices={bundle.byStatus} />
          </div>
        </section>

        <section style={card}>
          <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Recent Transactions</h2>
          {bundle.recentTransactions.length === 0 ? (
            <div style={{ border: "1px dashed #CBD5E1", borderRadius: 12, padding: 24, textAlign: "center", color: "#64748B", fontSize: 14 }}>
              No payments recorded yet — collections will appear here.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
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
        </section>
      </main>
    </div>
  );
}
