"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, mutedStyle, pageFrame, primaryBtn } from "@/lib/theme";
import { isFailure } from "../../lib/api";
import { SkeletonBlocks } from "../../components/ui/shell";
import { SignInGate } from "../../components/ui/sign-in-gate";

interface BillingOverview {
  school: {
    id: string;
    name: string;
    subscriptionStatus: string;
    plan: string | null;
    trialEndsAt: string;
    state: string | null;
  };
  subscription: { plan: string; status: string } | null;
  effectivePlan: string;
  usage: { enrolled: number; cap: number | null };
}

interface ApiError {
  error: { code: string; message: string };
}

// School settings (§7 #26 export home): a real profile view (who this
// school is on the platform, straight from the billing mirror — never
// client-trusted state) plus the data-export action (whole-school ZIP,
// one per hour, audited — its rows land on the audit-logs board). Plan,
// invoices and online payment live on /billing; this page links to it
// instead of duplicating the checkout surfaces. No Shell here (same
// shape as the audit-logs page): the role boards link in, the page
// gates itself.
export default function SettingsPage() {
  // schoolSlug is echoed for orientation only (client-known, never trusted
  // for access — every route re-derives school from the token).
  const { token, schoolId, schoolSlug, ready, apiFetch, user } = useAuth();
  const canView = user?.role === "SCHOOL_ADMIN";
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [expNotice, setExpNotice] = useState("");
  const [expError, setExpError] = useState("");

  const loadProfile = useCallback(async () => {
    if (!schoolId) {
      return;
    }
    setProfileLoading(true);
    setProfileError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/billing/overview`);
      const body = (await response.json()) as { data: BillingOverview } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Failed to load the school profile.");
      }
      setOverview(body.data);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setProfileLoading(false);
    }
  }, [schoolId, apiFetch]);

  useEffect(() => {
    if (!ready || !token || !schoolId || !canView) {
      return;
    }
    void loadProfile();
  }, [ready, token, schoolId, apiFetch, canView, loadProfile]);

  async function exportSchool(): Promise<void> {
    if (!schoolId || exporting) {
      return;
    }
    setExporting(true);
    setExpNotice("");
    setExpError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/exports`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json()) as ApiError;
        throw new Error(body.error?.message ?? "Export failed.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "studyfy-export.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setExpNotice("Export downloaded — filter DATA_EXPORT on the audit board to see its audit row.");
    } catch (err) {
      setExpError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setExporting(false);
    }
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, marginBottom: 14 }}>Settings</h1>
        <SkeletonBlocks rows={3} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Settings</h1>
        <SignInGate prompt="Please sign in to view settings." />
      </main>
    );
  }

  if (!canView) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Settings</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>
            Settings live with the School Admin — staff, go through them for exports.
          </p>
        </div>
      </main>
    );
  }

  const statusLine = overview
    ? [overview.school.subscriptionStatus, overview.subscription ? `${overview.subscription.plan} tier` : null]
        .filter(Boolean)
        .join(" — ")
    : "";

  const trialLine =
    overview && !overview.subscription && overview.school.trialEndsAt
      ? `Trial ends ${new Date(overview.school.trialEndsAt).toLocaleDateString("en-GB")}`
      : "";

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Settings</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>School {schoolSlug || schoolId} — profile, plan and data.</p>

      <div className="sf-card" style={{ ...cardStyle, marginBottom: 12 }}>
        <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px", color: colors.ink }}>School profile</p>
        {profileLoading ? <SkeletonBlocks rows={2} height={28} /> : null}
        {profileError ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "0 0 8px" }}>
            {profileError}
          </p>
        ) : null}
        {overview ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "150px 1fr",
                gap: "6px 12px",
                fontSize: 13.5,
                alignItems: "baseline",
              }}
            >
              <span style={{ color: colors.muted }}>School name</span>
              <span style={{ color: colors.ink, fontWeight: 600 }}>{overview.school.name}</span>
              <span style={{ color: colors.muted }}>Plan &amp; status</span>
              <span style={{ color: colors.ink }}>
                {overview.effectivePlan}
                {statusLine ? ` · ${statusLine}` : ""}
              </span>
              <span style={{ color: colors.muted }}>Enrolment</span>
              <span style={{ color: colors.ink }}>
                {overview.usage.enrolled} pupil{overview.usage.enrolled === 1 ? "" : "s"}
                {overview.usage.cap != null ? ` of ${overview.usage.cap} in this plan` : ""}
              </span>
              <span style={{ color: colors.muted }}>State</span>
              <span style={{ color: colors.ink }}>{overview.school.state ?? "—"}</span>
              {trialLine ? (
                <>
                  <span style={{ color: colors.muted }}>Trial</span>
                  <span style={{ color: colors.ink }}>{trialLine}</span>
                </>
              ) : null}
            </div>
            <p style={{ fontSize: 13, margin: "12px 0 0" }}>
              <Link href="/billing" style={{ color: colors.primary, fontWeight: 600, textDecoration: "none" }}>
                Plan upgrades, invoices and payment live on the Billing board →
              </Link>
            </p>
          </>
        ) : null}
      </div>

      <div className="sf-card" style={{ ...cardStyle, marginBottom: 12 }}>
        <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: colors.ink }}>Data export</p>
        <p style={{ ...mutedStyle, fontSize: 13, margin: "0 0 12px" }}>
          Whole-school ZIP (JSON per table, secrets excluded) — one per hour, always audited.
        </p>
        <div className="sf-row-wrap" style={{ alignItems: "center" }}>
          <button type="button" onClick={() => void exportSchool()} disabled={exporting} style={primaryBtn}>
            {exporting ? "Exporting…" : "Download export"}
          </button>
        </div>
        {expNotice ? <p style={{ color: colors.success, fontSize: 14, margin: "8px 0 0" }}>{expNotice}</p> : null}
        {expError ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "8px 0 0" }}>
            {expError}
          </p>
        ) : null}
      </div>
    </main>
  );
}
