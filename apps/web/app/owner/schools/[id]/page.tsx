"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { EmptyState, Shell, SkeletonBlocks } from "../../../../components/ui/shell";
import { isFailure } from "../../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, mutedStyle, pageFrame, pill } from "@/lib/theme";

interface DetailSchool {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  brandColor: string | null;
  subscriptionStatus: string;
  plan: string | null;
  trialEndsAt: string | null;
  isDemo: boolean;
  createdAt: string;
  _count: { users: number; students: number };
}

interface DetailSubscription {
  plan: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

interface DetailAdmin {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  actorId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

interface SchoolDetail {
  school: DetailSchool;
  subscription: DetailSubscription | null;
  usage: { enrolled: number; cap: number | null };
  admins: DetailAdmin[];
  recentAudit: AuditEntry[];
}

interface ApiError {
  error: { code: string; message: string };
}

function fmtDay(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString("en-GB");
}

function statusPill(status: string) {
  if (status === "ACTIVE") {
    return pill(colors.success, colors.successTint);
  }
  if (status === "SUSPENDED") {
    return pill(colors.danger, colors.dangerTint);
  }
  return pill(colors.warning, colors.warningTint);
}

// School detail (§7 #23): one tenant's full owner picture — profile, plan +
// usage vs cap, subscription row, admin contacts, recent audit trail
// (reasons included, proving every action asked why). Read-only: the
// billing levers live on the roster's Manage panels.
export default function OwnerSchoolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { token, ready, apiFetch, user } = useAuth();
  const isOwner = user?.role === "PLATFORM_OWNER";
  const [detail, setDetail] = useState<SchoolDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/platform/schools/${id}/detail`);
      const body = (await response.json()) as { data: SchoolDetail } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Failed to load the school.");
      }
      setDetail(body.data);
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, id]);

  useEffect(() => {
    if (!ready || !token || !isOwner) {
      return;
    }
    void load();
  }, [ready, token, isOwner, apiFetch, load]);

  if (!ready) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/schools">
        <main style={pageFrame}>
          <h1 style={{ ...h1Style, marginBottom: 14 }}>School</h1>
          <SkeletonBlocks rows={4} />
        </main>
      </Shell>
    );
  }

  if (!token || !isOwner) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/schools">
        <main style={pageFrame}>
          <h1 style={{ ...h1Style, margin: "0 0 12px" }}>School</h1>
          <div className="sf-card" style={{ padding: 20 }}>
            <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>Platform access only.</p>
          </div>
        </main>
      </Shell>
    );
  }

  const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: colors.ink };
  const rowText: React.CSSProperties = { fontSize: 14, color: colors.ink, margin: "4px 0" };

  return (
    <Shell role="PLATFORM_OWNER" activeHref="/owner/schools">
      <main style={pageFrame}>
        <h1 style={h1Style}>{detail?.school.name ?? "School"}</h1>
        <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
          <Link href="/owner/schools" style={{ color: colors.primary, fontWeight: 600, textDecoration: "none" }}>
            Back to schools
          </Link>
        </p>

        {loading ? (
          <SkeletonBlocks rows={4} />
        ) : error ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 14 }}>
            {error}
          </p>
        ) : !detail ? (
          <EmptyState
            icon={<Building2 size={22} aria-hidden="true" />}
            title="School not found"
            detail="It may have been removed."
          />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <section className="sf-card" style={{ ...cardStyle }}>
              <p style={sectionTitle}>Profile</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                <span style={statusPill(detail.school.subscriptionStatus)}>{detail.school.subscriptionStatus}</span>
                <span style={pill(colors.primary, colors.primaryGhost)}>{detail.school.plan ?? "no plan"}</span>
                {detail.school.isDemo ? <span style={pill(colors.warning, colors.warningTint)}>DEMO</span> : null}
              </div>
              <p style={rowText}>
                {detail.school.slug} · {detail.school.city ?? "—"}, {detail.school.state ?? "—"} · joined{" "}
                {fmtDay(detail.school.createdAt)}
              </p>
              <p style={rowText}>
                {detail.school._count.students} pupils · {detail.school._count.users} accounts
              </p>
            </section>

            <section className="sf-card" style={{ ...cardStyle }}>
              <p style={sectionTitle}>Plan &amp; usage</p>
              <p style={rowText} data-testid="detail-usage">
                {detail.usage.cap === null
                  ? `${detail.usage.enrolled.toLocaleString("en-IN")} students · Unlimited`
                  : `${detail.usage.enrolled.toLocaleString("en-IN")} of ${detail.usage.cap.toLocaleString("en-IN")} students used`}
                {detail.usage.cap !== null && detail.usage.enrolled >= detail.usage.cap ? " — at capacity." : ""}
              </p>
              <p style={rowText}>
                Subscription:{" "}
                {detail.subscription
                  ? `${detail.subscription.plan} · ${detail.subscription.status} · ${fmtDay(detail.subscription.currentPeriodStart)} → ${fmtDay(detail.subscription.currentPeriodEnd)}`
                  : "none yet"}
              </p>
            </section>

            <section className="sf-card" style={{ ...cardStyle }}>
              <p style={sectionTitle}>Admin contacts</p>
              {detail.admins.length === 0 ? (
                <p style={rowText}>No active admins.</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                  {detail.admins.map((a) => (
                    <li key={a.id} style={{ ...rowText, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span>
                        {a.name} · {a.email}
                      </span>
                      {!a.isActive ? <span style={pill(colors.danger, colors.dangerTint)}>INACTIVE</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="sf-card" style={{ ...cardStyle }}>
              <p style={sectionTitle}>Recent audit entries</p>
              {detail.recentAudit.length === 0 ? (
                <p style={rowText}>No audit rows yet.</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                  {detail.recentAudit.map((r) => (
                    <li key={r.id} style={{ fontSize: 13, color: colors.inkSoft }}>
                      <strong style={{ color: colors.ink }}>{r.action}</strong> · {r.entity} ·{" "}
                      {fmtDay(r.createdAt)}
                      {typeof r.after === "object" && r.after !== null && "reason" in r.after && typeof (r.after as { reason?: unknown }).reason === "string" ? (
                        <> · “{(r.after as { reason: string }).reason}”</>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </Shell>
  );
}
