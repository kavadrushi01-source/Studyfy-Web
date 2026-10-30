"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SignInLink } from "@/components/ui/sign-in-gate";
import { Bell, FileText, GraduationCap, TrendingUp, UserCheck, Wallet } from "lucide-react";
import { Card, EmptyState, SectionTitle, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
import { colors, gradients, h1Style, iconTile, labelStyle, mutedStyle } from "@/lib/theme";
import { isFailure } from "../../../lib/api";

interface SubjectProgress {
  subjectName: string;
  percent: number;
  scored: number;
}

interface NoticeItem {
  id: string;
  title: string;
  at: string;
}

interface ChildBoard {
  attendancePercent: number | null;
  overallMarks: number | null;
  feesDue: string;
  nextExam: { id: string; title: string; date: string | null } | null;
  recentNotices: NoticeItem[];
  progressBySubject: SubjectProgress[];
  asOf: { day: string };
}

interface ParentBundle {
  children: { studentId: string; name: string }[];
  selectedChildId: string;
  board: ChildBoard;
}

interface ApiError {
  error: { code: string; message: string };
}

// Parent board (§7 Phase 1 #9, §8.3): shared Shell with the canonical
// parent nav (§8.4), greeting, child selector, per-selected-child KPI
// cards, Child Progress chart (subject-wise averages), Recent Notices,
// Quick Actions (Pay Fees, Message Teacher, View Homework). Same rules as
// the other boards: every figure from GET .../dashboard/parent, nulls are
// "no data yet" (§8.1), token-paste until login, skeleton loading (§8.5).

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

function inr(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return `₹${amount}`;
  }
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ParentDashboardPage() {
  const { token, schoolId, user, ready, apiFetch } = useAuth();
  const [bundle, setBundle] = useState<ParentBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (childId: string | null) => {
      if (!schoolId) {
        throw new Error("No school on this account");
      }
      const path =
        childId === null
          ? `/api/v1/schools/${schoolId}/dashboard/parent`
          : `/api/v1/schools/${schoolId}/dashboard/parent?with=${childId}`;
      const dashRes = await apiFetch(path);
      const dashBody = (await dashRes.json()) as { data: { dashboard: ParentBundle } } | ApiError;
      if (isFailure(dashRes, dashBody)) {
        throw new Error(dashBody.error?.message ?? "Dashboard unavailable.");
      }
      setBundle(dashBody.data.dashboard);
    },
    [schoolId, apiFetch],
  );

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        await load(null);
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
  }, [ready, token, schoolId, load]);

  const switchChild = useCallback(
    async (childId: string) => {
      setSwitching(true);
      setError("");
      try {
        await load(childId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setSwitching(false);
      }
    },
    [load],
  );

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
        <p style={{ color: colors.muted, margin: "0 0 20px" }}>Sign in to view your children&apos;s board.</p>
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
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Parent Dashboard</h1>
        <p style={{ color: colors.danger, fontSize: 14 }}>No school on this account</p>
      </main>
    );
  }

  if (user && user.role !== "PARENT") {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Parent Dashboard</h1>
        <p style={{ color: colors.danger, fontSize: 14 }}>This board is for parents — your account holds a different role.</p>
      </main>
    );
  }

  if (loading || !bundle) {
    return (
      <Shell role="PARENT" activeHref="/dashboard/parent">
        {error ? <p style={{ color: colors.danger, fontSize: 14 }}>{error}</p> : null}
        <SkeletonBlocks rows={3} />
      </Shell>
    );
  }

  const board = bundle.board;
  const kpis: { label: string; value: string; sub?: string | null; color: string; tint: string; icon: ReactNode }[] = [
    { label: "Attendance", value: board.attendancePercent === null ? "No data yet" : `${board.attendancePercent}%`, color: colors.primary, tint: colors.primaryGhost, icon: <UserCheck size={22} /> },
    { label: "Average Marks", value: board.overallMarks === null ? "No data yet" : `${board.overallMarks}%`, color: colors.success, tint: colors.successTint, icon: <GraduationCap size={22} /> },
    { label: "Fees Due", value: inr(board.feesDue), color: Number(board.feesDue) > 0 ? colors.warning : colors.primary, tint: Number(board.feesDue) > 0 ? colors.warningTint : colors.primaryGhost, icon: <Wallet size={22} /> },
    {
      label: "Upcoming Exams",
      value: board.nextExam ? board.nextExam.title : "None scheduled",
      sub: board.nextExam?.date ?? null,
      color: colors.accent,
      tint: colors.accentTint,
      icon: <FileText size={22} />,
    },
  ];

  return (
    <Shell role="PARENT" activeHref="/dashboard/parent">
      <header style={{ marginBottom: 24, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={h1Style}>
            {greeting(new Date())}, {user?.name ?? ""}
          </h1>
          <p style={{ ...mutedStyle, margin: "4px 0 0" }}>
            Your child&apos;s progress · {board.asOf.day}
          </p>
        </div>
        <label style={labelStyle}>
          Child
          <select
            value={bundle.selectedChildId}
            disabled={switching}
            onChange={(e) => switchChild(e.target.value)}
            className="sf-select"
            style={{ minWidth: 200 }}
          >
            {bundle.children.map((child) => (
              <option key={child.studentId} value={child.studentId}>
                {child.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      {error ? <p style={{ color: colors.danger, fontSize: 14 }}>{error}</p> : null}
      {switching ? (
        <div style={{ marginBottom: 16 }}>
          <SkeletonBlocks rows={2} height={48} />
        </div>
      ) : null}

      <section className="sf-grid-kpi" style={{ marginBottom: 20, opacity: switching ? 0.55 : 1 }}>
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

      <section className="sf-grid-2-1" style={{ marginBottom: 20 }}>
        <Card>
          <SectionTitle>Child Progress</SectionTitle>
          <p style={{ fontSize: 13, color: colors.muted, margin: "0 0 12px" }}>Average score per subject</p>
          {board.progressBySubject.length === 0 ? (
            <EmptyState icon={<TrendingUp size={22} />} title="No progress yet" detail="No marked work yet — subject averages will appear here." />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
              {board.progressBySubject.map((row) => (
                <li key={row.subjectName}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
                    <span style={{ color: colors.ink, fontWeight: 600 }}>{row.subjectName}</span>
                    <span style={{ color: colors.muted }}>{row.percent}% · {row.scored} marked</span>
                  </div>
                  <div style={{ height: 10, borderRadius: 999, background: colors.lineSoft, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, row.percent)}%`,
                        borderRadius: 999,
                        background: gradients.accent,
                        transition: "width 400ms cubic-bezier(.22,1,.36,1)",
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle>Quick Actions</SectionTitle>
          <div style={{ display: "grid", gap: 12 }}>
            {[
              { label: "Pay Fees", href: "/fees" },
              { label: "Message Teacher", href: "/messages" },
              { label: "View Homework", href: "/homework" },
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
        <SectionTitle>Recent Notices</SectionTitle>
        {board.recentNotices.length === 0 ? (
          <EmptyState icon={<Bell size={22} />} title="No notices" detail="No notices for your child right now." />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {board.recentNotices.map((notice, index) => (
              <li
                key={notice.id}
                onMouseEnter={rowHoverIn}
                onMouseLeave={rowHoverOut}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "8px 8px",
                  margin: "0 -8px",
                  borderRadius: 10,
                  transition: "background 140ms cubic-bezier(.22,1,.36,1)",
                  borderTop: index === 0 ? 0 : `1px solid ${colors.lineSoft}`,
                  fontSize: 14,
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    background: colors.primaryGhost,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 3,
                    flexShrink: 0,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: colors.primary }} />
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: colors.ink, fontWeight: 600 }}>{notice.title}</div>
                  <div style={{ fontSize: 12, color: colors.muted }}>{new Date(notice.at).toLocaleDateString()}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>
  );
}
