"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { EmptyState, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, pill } from "@/lib/theme";

interface OwnerSchool {
  id: string;
  name: string;
  slug: string;
  subscriptionStatus: string;
  plan: string | null;
  trialEndsAt: string | null;
  createdAt: string;
  _count: { users: number; students: number };
}

interface ApiError {
  error: { code: string; message: string };
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

// Schools (§7 #23): the platform's tenant roster — search, status/plan at
// a glance, and the billing levers (suspend/reactivate/plan/trial) per
// row. Suspension retains data (§16); demo schools refuse (portfolio demo
// stays up — the API enforces it, the button explains it).
export default function OwnerSchoolsPage() {
  const { token, ready, apiFetch, user } = useAuth();
  const isOwner = user?.role === "PLATFORM_OWNER";
  const [schools, setSchools] = useState<OwnerSchool[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState("");
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState("STANDARD");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [trialDate, setTrialDate] = useState("");
  const [acting, setActing] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/api/v1/platform/schools");
      const body = (await response.json()) as { data: { schools: OwnerSchool[] } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Failed to load schools.");
      }
      setSchools(body.data.schools);
    } catch (err) {
      setSchools([]);
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    if (!ready || !token || !isOwner) {
      return;
    }
    void load();
  }, [ready, token, isOwner, apiFetch, load]);

  async function act(path: string, body: Record<string, string>, busyKey: string, done: string): Promise<void> {
    setActing(busyKey);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = (await response.json()) as { data?: unknown } | ApiError;
      if (isFailure(response, resBody)) {
        throw new Error(resBody.error?.message ?? "Action failed.");
      }
      setNotice(done);
      setOpenId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setActing("");
    }
  }

  if (!ready) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/schools">
        <main style={pageFrame}>
          <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Schools</h1>
          <SkeletonBlocks rows={4} />
        </main>
      </Shell>
    );
  }

  if (!token) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/schools">
        <main style={pageFrame}>
          <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Schools</h1>
          <div className="sf-card" style={{ padding: 20 }}>
            <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in as the Platform Owner.</p>
            <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
              Go to login
            </Link>
          </div>
        </main>
      </Shell>
    );
  }

  if (!isOwner) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/schools">
        <main style={pageFrame}>
          <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Schools</h1>
          <div className="sf-card" style={{ padding: 20 }}>
            <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>
              Platform access only — your school boards carry your own data.
            </p>
          </div>
        </main>
      </Shell>
    );
  }

  const visible = schools.filter(
    (s) =>
      !search.trim() ||
      s.name.toLowerCase().includes(search.trim().toLowerCase()) ||
      s.slug.includes(search.trim().toLowerCase()),
  );

  return (
    <Shell role="PLATFORM_OWNER" activeHref="/owner/schools">
      <main style={pageFrame}>
        <h1 style={h1Style}>Schools</h1>
        <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
          Every tenant at a glance — status, plan, headcounts, and the billing levers. Suspension retains data.
        </p>
        <div className="sf-row-wrap" style={{ marginBottom: 12 }}>
          <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
            Search
            <input
              className="sf-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or slug"
              aria-label="Search schools"
            />
          </label>
        </div>

        {loading ? (
          <SkeletonBlocks rows={4} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Building2 size={22} aria-hidden="true" />}
            title="No schools match"
            detail="Clear the search — new registrations appear here automatically."
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {visible.map((school) => (
              <li key={school.id} className="sf-card" style={{ padding: 16 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ color: colors.ink, fontSize: 15, flex: 1 }}>{school.name}</strong>
                  <span style={statusPill(school.subscriptionStatus)}>{school.subscriptionStatus}</span>
                  <span style={pill(colors.primary, colors.primaryGhost)}>{school.plan ?? "no plan"}</span>
                  <button type="button" onClick={() => setOpenId((prev) => (prev === school.id ? "" : school.id))} className="sf-btn" aria-expanded={openId === school.id}>
                    {openId === school.id ? "Close" : "Manage"}
                  </button>
                </div>
                <p style={{ ...mutedStyle, fontSize: 13, margin: "6px 0 0" }}>
                  {school.slug} · {school._count.students} pupils · {school._count.users} accounts
                </p>
                {openId === school.id ? (
                  <div style={{ marginTop: 10, borderTop: "1px solid #F1F5F9", paddingTop: 10, display: "grid", gap: 10 }}>
                    <div className="sf-row-wrap" style={{ alignItems: "flex-end" }}>
                      <label style={{ ...labelStyle, flex: 1, minWidth: 160 }}>
                        Suspend reason (optional)
                        <input
                          className="sf-input"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="Non-payment"
                          aria-label={`Suspend reason for ${school.name}`}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void act(`/platform/schools/${school.id}/suspend`, reason.trim() ? { reason: reason.trim() } : {}, `suspend-${school.id}`, `${school.name} suspended.`)}
                        disabled={!!acting}
                        className="sf-btn"
                      >
                        {acting === `suspend-${school.id}` ? "Working…" : "Suspend"}
                      </button>
                    </div>
                    <div className="sf-row-wrap" style={{ alignItems: "flex-end" }}>
                      <label style={labelStyle}>
                        Plan
                        <select className="sf-select" value={plan} onChange={(e) => setPlan(e.target.value)} aria-label={`Plan for ${school.name}`}>
                          <option value="BASIC">Basic</option>
                          <option value="STANDARD">Standard</option>
                          <option value="PREMIUM">Premium</option>
                        </select>
                      </label>
                      <label style={labelStyle}>
                        Period start
                        <input className="sf-input" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} aria-label={`Period start for ${school.name}`} />
                      </label>
                      <label style={labelStyle}>
                        Period end
                        <input className="sf-input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} aria-label={`Period end for ${school.name}`} />
                      </label>
                      <button
                        type="button"
                        onClick={() => void act(`/platform/schools/${school.id}/reactivate`, { plan, periodStart, periodEnd }, `reactivate-${school.id}`, `${school.name} reactivated.`)}
                        disabled={!!acting}
                        className="sf-btn"
                      >
                        {acting === `reactivate-${school.id}` ? "Working…" : "Reactivate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void act(`/platform/schools/${school.id}/plan`, { plan }, `plan-${school.id}`, `${school.name} moved to ${plan}.`)}
                        disabled={!!acting}
                        className="sf-btn"
                      >
                        {acting === `plan-${school.id}` ? "Working…" : "Set plan"}
                      </button>
                    </div>
                    <div className="sf-row-wrap" style={{ alignItems: "flex-end" }}>
                      <label style={labelStyle}>
                        Trial ends
                        <input className="sf-input" type="date" value={trialDate} onChange={(e) => setTrialDate(e.target.value)} aria-label={`Trial end for ${school.name}`} />
                      </label>
                      <button
                        type="button"
                        onClick={() => void act(`/platform/schools/${school.id}/trial-extension`, { trialEndsAt: trialDate }, `trial-${school.id}`, `Trial extended for ${school.name}.`)}
                        disabled={!!acting}
                        className="sf-btn"
                      >
                        {acting === `trial-${school.id}` ? "Working…" : "Extend trial"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
        {error ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
            {error}
          </p>
        ) : null}
      </main>
    </Shell>
  );
}
