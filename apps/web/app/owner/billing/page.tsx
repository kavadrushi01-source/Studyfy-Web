"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ReceiptIndianRupee } from "lucide-react";
import { EmptyState, Shell, SkeletonBlocks } from "../../../components/ui/shell";
import { isFailure } from "../../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

interface SchoolOption {
  id: string;
  name: string;
  slug: string;
}

interface SubscriptionInvoice {
  id: string;
  invoiceNumber: string;
  financialYear: string;
  amountPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  paidMethod: string | null;
}

interface ApiError {
  error: { code: string; message: string };
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

// Subscriptions & billing (§7 #24, §16.1): per-school invoices, manual
// issue + mark-paid, online captures arriving via the shared webhook.
// Every invoice prints TEST INVOICE while this is a portfolio project —
// the page says so out loud (§16.1), same as the school-side board.
export default function OwnerBillingPage() {
  const { token, ready, apiFetch, user } = useAuth();
  const isOwner = user?.role === "PLATFORM_OWNER";
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [schoolId, setSchoolId] = useState("");
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [plan, setPlan] = useState("STANDARD");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [acting, setActing] = useState("");

  const loadSchools = useCallback(async () => {
    const response = await apiFetch("/api/v1/platform/schools");
    const body = (await response.json()) as { data: { schools: SchoolOption[] } } | ApiError;
    if (isFailure(response, body)) {
      throw new Error(body.error?.message ?? "Failed to load schools.");
    }
    setSchools(body.data.schools);
    if (!schoolId && body.data.schools.length > 0) {
      setSchoolId(body.data.schools[0]?.id ?? "");
    }
  }, [apiFetch, schoolId]);

  const loadInvoices = useCallback(async () => {
    if (!schoolId) {
      setInvoices([]);
      return;
    }
    const response = await apiFetch(`/api/v1/platform/subscription-invoices?schoolId=${schoolId}&take=50`);
    const body = (await response.json()) as { data: { invoices: SubscriptionInvoice[] } } | ApiError;
    if (isFailure(response, body)) {
      throw new Error(body.error?.message ?? "Failed to load invoices.");
    }
    setInvoices(body.data.invoices);
  }, [apiFetch, schoolId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await loadSchools();
      await loadInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [loadSchools, loadInvoices]);

  useEffect(() => {
    if (!ready || !token || !isOwner) {
      return;
    }
    void refresh();
  }, [ready, token, isOwner, refresh]);

  useEffect(() => {
    if (!ready || !token || !isOwner || !schoolId) {
      return;
    }
    setLoading(true);
    loadInvoices()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Network error."))
      .finally(() => setLoading(false));
  }, [schoolId, ready, token, isOwner, loadInvoices]);

  async function issue(): Promise<void> {
    if (!schoolId || !periodStart || !periodEnd) {
      setError("Pick a school and both period dates first.");
      return;
    }
    setActing("issue");
    setError("");
    setNotice("");
    try {
      const response = await apiFetch("/api/v1/platform/subscription-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, plan, periodStart, periodEnd }),
      });
      const body = (await response.json()) as { data: { invoice: SubscriptionInvoice } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Issue failed.");
      }
      setNotice(`Issued ${body.data.invoice.invoiceNumber}.`);
      await loadInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setActing("");
    }
  }

  async function markPaid(invoiceId: string): Promise<void> {
    setActing(`pay-${invoiceId}`);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/platform/subscription-invoices/${invoiceId}/mark-paid`, { method: "POST" });
      const body = (await response.json()) as { data?: unknown } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Mark-paid failed.");
      }
      setNotice("Invoice marked paid — subscription re-activated.");
      await loadInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setActing("");
    }
  }

  const gate = (title: string, detail: React.ReactNode) => (
    <Shell role="PLATFORM_OWNER" activeHref="/owner/billing">
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Subscriptions &amp; Billing</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>{title}</p>
          {detail}
        </div>
      </main>
    </Shell>
  );

  if (!ready) {
    return (
      <Shell role="PLATFORM_OWNER" activeHref="/owner/billing">
        <main style={pageFrame}>
          <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Subscriptions &amp; Billing</h1>
          <SkeletonBlocks rows={4} />
        </main>
      </Shell>
    );
  }

  if (!token) {
    return gate("Please sign in as the Platform Owner.", <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>Go to login</Link>);
  }

  if (!isOwner) {
    return gate("Platform access only — your school boards carry your own data.", null);
  }

  return (
    <Shell role="PLATFORM_OWNER" activeHref="/owner/billing">
      <main style={pageFrame}>
        <h1 style={h1Style}>Subscriptions &amp; Billing</h1>
        <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
          Issue test invoices, record manual payments, watch online captures land. Every invoice is a TEST INVOICE.
        </p>
        <div className="sf-row-wrap" style={{ alignItems: "flex-end", marginBottom: 12 }}>
          <label style={{ ...labelStyle, flex: 1, minWidth: 200 }}>
            School
            <select className="sf-select" value={schoolId} onChange={(e) => setSchoolId(e.target.value)} aria-label="School">
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 12px" }}>Issue invoice</h2>
          <div className="sf-row-wrap" style={{ alignItems: "flex-end" }}>
            <label style={labelStyle}>
              Plan
              <select className="sf-select" value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan">
                <option value="BASIC">Basic ₹2,999/mo</option>
                <option value="STANDARD">Standard ₹5,999/mo</option>
                <option value="PREMIUM">Premium ₹9,999/mo</option>
              </select>
            </label>
            <label style={labelStyle}>
              Period start
              <input className="sf-input" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} aria-label="Period start" />
            </label>
            <label style={labelStyle}>
              Period end
              <input className="sf-input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} aria-label="Period end" />
            </label>
            <button type="button" onClick={() => void issue()} disabled={acting === "issue"} style={{ ...primaryBtn, opacity: acting === "issue" ? 0.6 : 1 }}>
              {acting === "issue" ? "Issuing…" : "Issue invoice"}
            </button>
          </div>
        </section>

        {loading ? (
          <SkeletonBlocks rows={3} />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={<ReceiptIndianRupee size={22} aria-hidden="true" />}
            title="No invoices for this school"
            detail="Issue the first one above — periods are idempotent, re-issuing returns the existing row."
          />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {invoices.map((invoice) => {
              const total = invoice.amountPaise + invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise;
              return (
                <li key={invoice.id} className="sf-card" style={{ padding: 16 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ color: colors.ink, fontSize: 15, flex: 1 }}>{invoice.invoiceNumber}</strong>
                    <span style={pill(colors.inkSoft, colors.primaryGhost)}>TEST INVOICE</span>
                    <span style={invoice.status === "PAID" ? pill(colors.success, colors.successTint) : pill(colors.warning, colors.warningTint)}>
                      {invoice.status}
                    </span>
                    {invoice.status === "PENDING" ? (
                      <button
                        type="button"
                        onClick={() => void markPaid(invoice.id)}
                        disabled={acting === `pay-${invoice.id}`}
                        className="sf-btn"
                      >
                        {acting === `pay-${invoice.id}` ? "Working…" : "Mark paid"}
                      </button>
                    ) : null}
                  </div>
                  <p style={{ ...mutedStyle, fontSize: 13, margin: "6px 0 0" }}>
                    {invoice.periodStart.slice(0, 10)} – {invoice.periodEnd.slice(0, 10)} · {rupees(total)}
                    {invoice.paidMethod ? ` · via ${invoice.paidMethod}` : ""}
                  </p>
                </li>
              );
            })}
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
