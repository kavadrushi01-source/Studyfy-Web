"use client";

import { useCallback, useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cardStyle, colors, h1Style, mutedStyle, pageFrame, pill } from "@/lib/theme";
import { isFailure } from "../../../lib/api";
import { EmptyState, Shell, SkeletonBlocks } from "../../../components/ui/shell";

interface PlanDef {
  plan: string;
  pricePaise: number;
  studentCap: number | null;
  features: string[];
  support: string;
}

interface SettingsData {
  environment: string;
  testMode: string;
  gstinConfigured: boolean;
  platformStateConfigured: boolean;
  demoPasswordConfigured: boolean;
  demoSchools: number;
  plans: Record<string, PlanDef>;
}

interface ApiError {
  error: { code: string; message: string };
}

function boolPill(value: boolean, trueLabel: string, falseLabel: string): React.ReactNode {
  return value ? (
    <span style={pill(colors.success, colors.successTint)}>{trueLabel}</span>
  ) : (
    <span style={pill(colors.muted, colors.lineSoft)}>{falseLabel}</span>
  );
}

// Platform Settings (§7 #23, read-only): environment mode, payment test
// mode, the plan matrix (same shared object the gates enforce), tax-config
// presence, demo-mode status. Booleans and catalog data ONLY — no secret is
// ever displayed here: not values, not prefixes, not lengths (pinned by an
// API test that scans every response string).
export default function OwnerSettingsPage() {
  const { token, ready, apiFetch, user } = useAuth();
  const isOwner = user?.role === "PLATFORM_OWNER";
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch("/api/v1/platform/settings");
      const body = (await response.json()) as { data: SettingsData } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Failed to load settings.");
      }
      setData(body.data);
    } catch (err) {
      setData(null);
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

  if (!ready) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/settings">
        <main style={pageFrame}>
          <h1 style={{ ...h1Style, marginBottom: 14 }}>Settings</h1>
          <SkeletonBlocks rows={4} />
        </main>
      </Shell>
    );
  }

  if (!token || !isOwner) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/settings">
        <main style={pageFrame}>
          <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Settings</h1>
          <div className="sf-card" style={{ padding: 20 }}>
            <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>Platform access only.</p>
          </div>
        </main>
      </Shell>
    );
  }

  const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: "0 0 8px", color: colors.ink };

  return (
    <Shell role="PLATFORM_OWNER" activeHref="/owner/settings">
      <main style={pageFrame}>
        <h1 style={h1Style}>Settings</h1>
        <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>Platform configuration — read-only, secrets never shown.</p>

        {loading ? (
          <SkeletonBlocks rows={4} />
        ) : error ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 14 }}>
            {error}
          </p>
        ) : !data ? (
          <EmptyState
            icon={<Settings2 size={20} aria-hidden="true" />}
            title="Settings unavailable"
            detail="Reload — if this persists, check the API."
          />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <section className="sf-card" style={{ ...cardStyle }}>
              <p style={sectionTitle}>Environment</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={pill(colors.primary, colors.primaryGhost)}>{data.environment}</span>
                {data.testMode === "TEST" ? (
                  <span style={pill(colors.warning, colors.warningTint)}>TEST MODE</span>
                ) : (
                  <span style={pill(colors.muted, colors.lineSoft)}>PAYMENTS UNCONFIGURED</span>
                )}
              </div>
              <p style={{ ...mutedStyle, fontSize: 13, margin: "8px 0 0" }}>
                Online payments run in test mode only — no real money moves.
              </p>
            </section>

            <section className="sf-card" style={{ ...cardStyle }}>
              <p style={sectionTitle}>Plan matrix</p>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 12, color: colors.muted, padding: "6px 8px" }}>Plan</th>
                    <th style={{ textAlign: "left", fontSize: 12, color: colors.muted, padding: "6px 8px" }}>Price</th>
                    <th style={{ textAlign: "left", fontSize: 12, color: colors.muted, padding: "6px 8px" }}>Students</th>
                    <th style={{ textAlign: "left", fontSize: 12, color: colors.muted, padding: "6px 8px" }}>Support</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.values(data.plans) as PlanDef[]).map((p) => (
                    <tr key={p.plan}>
                      <td style={{ fontSize: 14, fontWeight: 700, color: colors.ink, padding: "6px 8px" }}>{p.plan}</td>
                      <td style={{ fontSize: 14, color: colors.ink, padding: "6px 8px" }}>
                        ₹{(p.pricePaise / 100).toLocaleString("en-IN")}/mo
                      </td>
                      <td style={{ fontSize: 14, color: colors.ink, padding: "6px 8px" }}>
                        {p.studentCap === null ? "Unlimited" : p.studentCap.toLocaleString("en-IN")}
                      </td>
                      <td style={{ fontSize: 14, color: colors.ink, padding: "6px 8px" }}>{p.support}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="sf-card" style={{ ...cardStyle }}>
              <p style={sectionTitle}>Tax configuration</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, color: colors.inkSoft }}>GSTIN</span>
                {boolPill(data.gstinConfigured, "CONFIGURED", "NOT SET")}
                <span style={{ fontSize: 14, color: colors.inkSoft }}>Platform state</span>
                {boolPill(data.platformStateConfigured, "CONFIGURED", "NOT SET")}
              </div>
              <p style={{ ...mutedStyle, fontSize: 13, margin: "8px 0 0" }}>
                Invoices print TEST INVOICE until a GSTIN is configured — one is never invented.
              </p>
            </section>

            <section className="sf-card" style={{ ...cardStyle }}>
              <p style={sectionTitle}>Demo mode</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, color: colors.inkSoft }}>Demo password</span>
                {boolPill(data.demoPasswordConfigured, "CONFIGURED", "NOT SET")}
                <span style={{ fontSize: 14, color: colors.inkSoft }}>
                  {data.demoSchools} demo school{data.demoSchools === 1 ? "" : "s"}
                </span>
              </div>
            </section>
          </div>
        )}
      </main>
    </Shell>
  );
}
