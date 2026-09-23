"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";

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

// Platform Owner board (§7 Phase 1 #9, §8.3 + sequencing note): navy badge
// with amber accent (§8.2), the canonical owner nav (§8.4 — destinations
// render as plain text until their pages exist), 4 KPI cards, searchable
// Schools table, Platform Analytics chart, Subscription Plans panel.
// Sequencing honesty: revenue shows ₹0.00 and plans render an explicit
// "arrives with Phase 4 billing" empty state — never projections (§8.1).
// The schools search filters the returned list client-side, which is the
// honest shape at this scale (tens of schools, one 100-row response), not
// a paged server query pretending at Google scale.

const NAVY = "#0F172A";
const OWNER_AMBER = "#F59E0B";
const PRIMARY = "#2563EB";
const CANVAS = "#F8FAFC";
const SUCCESS = "#059669";
const WARNING = "#D97706";
const DANGER = "#DC2626";

const NAV: { label: string; href: string | null }[] = [
  { label: "Dashboard", href: "/dashboard/owner" },
  { label: "Schools", href: null },
  { label: "Subscriptions & Billing", href: null },
  { label: "Platform Analytics", href: null },
  { label: "Users Management", href: null },
  { label: "Support & Impersonation", href: null },
  { label: "Audit Logs", href: null },
  { label: "Settings", href: null },
];

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: SUCCESS,
  TRIAL: WARNING,
  SUSPENDED: DANGER,
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

function Icon({ d }: { d: string }): ReactNode {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
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

export default function OwnerDashboardPage() {
  const [email, setEmail] = useState("");
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
        if (!meRes.ok || "error" in meBody) {
          throw new Error("error" in meBody ? (meBody.error?.message ?? "Sign-in failed.") : "Sign-in failed.");
        }
        if (meBody.data.user.role !== "PLATFORM_OWNER") {
          throw new Error("This board is for the platform owner — your account holds a different role.");
        }
        const dashBody = (await dashRes.json()) as { data: { dashboard: OwnerBundle } } | ApiError;
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
    [api, token],
  );

  if (!connected || !me || !bundle) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Platform Dashboard</h1>
        <p style={{ color: "#64748B", margin: "0 0 20px" }}>Paste a platform-owner token to load the live board (no school slug — owners sign in without one).</p>
        <form onSubmit={connect} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 14 }}>
            Owner email (reminder only — identity comes from the token)
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@studyfy.dev" style={{ padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }} />
          </label>
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
            {[0, 1, 2].map((i) => (
              <div key={i} style={skeleton} />
            ))}
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

  const kpis = [
    { label: "Total Schools", value: String(bundle.totalSchools), color: PRIMARY, icon: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10" },
    { label: "Active Schools", value: String(bundle.activeSchools), color: SUCCESS, icon: "M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" },
    { label: "Trial / Pending", value: String(bundle.trialPending), color: WARNING, icon: "M12 8v4l3 3 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" },
    { label: "Total Revenue", value: "₹0.00", sub: "Billing lands in Phase 4", color: "#64748B", icon: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16V7 M18 12a2 2 0 0 0 0 4h-4a2 2 0 0 1 0-4z" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif", background: CANVAS }}>
      <aside style={{ width: 248, background: NAVY, color: "#E2E8F0", padding: "20px 14px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px 16px" }}>
          <span style={{ width: 36, height: 36, borderRadius: 10, background: PRIMARY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20 }}>S</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>Studyfy</span>
        </div>
        <div style={{ margin: "0 8px 16px", display: "inline-block", fontSize: 12, fontWeight: 600, background: NAVY, border: `1px solid ${OWNER_AMBER}`, color: OWNER_AMBER, borderRadius: 999, padding: "4px 12px" }}>
          Platform Owner
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
                  background: item.href === "/dashboard/owner" ? "#1E293B" : "transparent",
                  borderLeft: item.href === "/dashboard/owner" ? `3px solid ${OWNER_AMBER}` : "3px solid transparent",
                  color: item.href === "/dashboard/owner" ? "#fff" : "#CBD5E1",
                  fontWeight: item.href === "/dashboard/owner" ? 600 : 400,
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
            The whole platform at a glance · {bundle.asOf.month}
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
              {"sub" in kpi && kpi.sub ? <div style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>{kpi.sub}</div> : null}
            </div>
          ))}
        </section>

        <section style={card}>
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
            <div style={emptyBox}>{query ? `No schools match "${search}".` : "No schools registered yet."}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
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
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginTop: 20 }}>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 4px", color: NAVY }}>Platform Analytics</h2>
            <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>New schools per month, last 6 months</p>
            <AnalyticsChart analytics={bundle.analytics} />
          </div>
          <div style={card}>
            <h2 style={{ fontSize: 16, margin: "0 0 12px", color: NAVY }}>Subscription Plans</h2>
            <div style={emptyBox}>
              No plan data yet — the plan mix renders here once Phase 4 billing exists. Total revenue likewise stays ₹0.00 until then.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
