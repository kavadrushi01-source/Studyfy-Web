"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ReceiptIndianRupee } from "lucide-react";
import { EmptyState, SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { loadCheckoutScript, openCheckout } from "@/lib/razorpay-checkout";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

interface PlanDef {
  plan: string;
  pricePaise: number;
  studentCap: number | null;
  features: string[];
  support: string;
  bullets: string[];
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

interface BillingOverview {
  school: {
    id: string;
    name: string;
    subscriptionStatus: string;
    plan: string | null;
    trialEndsAt: string;
    state: string | null;
  };
  subscription: { plan: string; status: string; currentPeriodStart: string | null; currentPeriodEnd: string | null } | null;
  invoices: SubscriptionInvoice[];
  plans: Record<string, PlanDef>;
  effectivePlan: string;
}

interface ApiError {
  error: { code: string; message: string };
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

function fmtDay(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString("en-GB");
}

// Subscription & billing (§16.1, Phase 4 Chunk 2): the school's plan,
// status, invoices (every one stamped TEST INVOICE while this is a
// portfolio project — never a tax invoice), and online payment (TEST MODE
// only, same hosted-checkout shape as fee collection). This is also the ONE
// page a suspended School Admin can still reach (§13.4 exception) — so it
// must render usefully on a SUSPENDED school instead of assuming access.
export default function BillingPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canView = user?.role === "SCHOOL_ADMIN";
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [payingId, setPayingId] = useState("");
  const [pendingOrders, setPendingOrders] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!schoolId) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/billing/overview`);
      const body = (await response.json()) as { data: BillingOverview } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Failed to load billing.");
      }
      setOverview(body.data);
    } catch (err) {
      setOverview(null);
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, apiFetch]);

  useEffect(() => {
    if (!ready || !token || !schoolId || !canView) {
      return;
    }
    void load();
  }, [ready, token, schoolId, apiFetch, canView, load]);

  // Online payment (§16.1, TEST MODE): invoice id only — the server prices
  // the order (amount + GST). No card form here by design; Razorpay's hosted
  // checkout collects details. After checkout, poll pay-verify so the row
  // flips without a manual refresh (same recovery shape as fee collection).
  async function payOnline(invoiceId: string): Promise<void> {
    if (!schoolId) {
      return;
    }
    setPayingId(invoiceId);
    setNotice("");
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/billing/invoices/${invoiceId}/pay-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as {
        data: { orderId: string; keyId: string; amount: string; currency: string };
      } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not start the online payment.");
      }
      await loadCheckoutScript();
      openCheckout({
        key: body.data.keyId,
        orderId: body.data.orderId,
        amountPaise: Math.round(Number(body.data.amount) * 100),
        description: `Studyfy subscription ${invoiceId.slice(0, 8)}`,
        onSuccess: () => {
          setNotice("Payment submitted — confirming with Razorpay…");
          setPendingOrders((prev) => ({ ...prev, [invoiceId]: body.data.orderId }));
          void pollVerify(body.data.orderId, 0);
        },
        onDismiss: () => {
          setNotice("Payment window closed — no charge was made.");
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setPayingId("");
    }
  }

  async function pollVerify(orderId: string, attempt: number): Promise<void> {
    if (!schoolId || attempt > 12) {
      if (attempt > 12) {
        setNotice("Still confirming — reopen this page any time; the row flips once confirmed.");
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/billing/pay-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const body = (await response.json()) as { data: { status: string } } | ApiError;
      if (!isFailure(response, body) && (body as { data: { status: string } }).data.status === "PAID") {
        setNotice("Payment confirmed — invoice paid.");
        await load();
        return;
      }
      await pollVerify(orderId, attempt + 1);
    } catch {
      await pollVerify(orderId, attempt + 1);
    }
  }

  // Manual recovery for a checkout whose webhook never arrived (§13.8):
  // reconciles OUR pending order id against what Razorpay holds.
  async function checkNow(invoiceId: string): Promise<void> {
    const orderId = pendingOrders[invoiceId];
    if (!schoolId || !orderId) {
      return;
    }
    setNotice("");
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/billing/pay-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const body = (await response.json()) as { data: { status: string } } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not verify.");
      }
      if ((body as { data: { status: string } }).data.status === "PAID") {
        setNotice("Payment confirmed — invoice paid.");
        await load();
      } else {
        setNotice("No capture found yet — try again shortly.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Billing</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Billing</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to view billing.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  if (!canView) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Billing</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: 0 }}>
            Subscription billing lives with the School Admin.
          </p>
        </div>
      </main>
    );
  }

  const status = overview?.school.subscriptionStatus ?? "";
  const plan = overview?.effectivePlan ?? "";

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Billing</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Subscription, invoices and online payment — test mode only, no real money moves.
      </p>

      {status === "SUSPENDED" ? (
        <div className="sf-card" style={{ padding: 16, marginBottom: 16, borderLeft: `4px solid ${colors.danger}` }}>
          <strong style={{ color: colors.danger }}>Account suspended.</strong>
          <p style={{ ...mutedStyle, fontSize: 14, margin: "6px 0 0" }}>
            Pay the outstanding invoice below (or contact the platform) to reactivate. Your data is retained.
          </p>
        </div>
      ) : null}
      {status === "PAST_DUE" ? (
        <div className="sf-card" style={{ padding: 16, marginBottom: 16, borderLeft: `4px solid ${colors.warning}` }}>
          <strong style={{ color: colors.warning }}>Payment past due.</strong>
          <p style={{ ...mutedStyle, fontSize: 14, margin: "6px 0 0" }}>
            Full access continues during the 7-day grace period — settle the invoice to stay active.
          </p>
        </div>
      ) : null}

      {loading ? (
        <SkeletonBlocks rows={4} />
      ) : !overview ? (
        <EmptyState
          icon={<ReceiptIndianRupee size={22} aria-hidden="true" />}
          title="Billing unavailable"
          detail="Reload, or contact support if this persists."
        />
      ) : (
        <>
          <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ color: colors.ink, fontSize: 16, flex: 1 }}>{overview.school.name}</strong>
              <span style={pill(colors.primary, colors.primaryGhost)}>{plan} plan</span>
              <span
                style={
                  status === "ACTIVE"
                    ? pill(colors.success, colors.successTint)
                    : status === "TRIAL"
                      ? pill(colors.warning, colors.warningTint)
                      : pill(colors.danger, colors.dangerTint)
                }
              >
                {status}
              </span>
            </div>
            <p style={{ ...mutedStyle, fontSize: 13, margin: "8px 0 0" }}>
              {overview.subscription?.currentPeriodEnd
                ? `Current period ends ${fmtDay(overview.subscription.currentPeriodEnd)}.`
                : `Trial ends ${fmtDay(overview.school.trialEndsAt)}.`}{" "}
              Every invoice below is a TEST INVOICE — not a tax invoice.
            </p>
          </section>

          {overview.invoices.length === 0 ? (
            <EmptyState
              icon={<ReceiptIndianRupee size={22} aria-hidden="true" />}
              title="No invoices yet"
              detail="Trial schools are invoiced when the trial ends."
            />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
              {overview.invoices.map((invoice) => {
                const total = invoice.amountPaise + invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise;
                const gstLabel =
                  invoice.igstPaise > 0
                    ? `incl. IGST ${rupees(invoice.igstPaise)}`
                    : `incl. CGST ${rupees(invoice.cgstPaise)} + SGST ${rupees(invoice.sgstPaise)}`;
                return (
                  <li key={invoice.id} className="sf-card" style={{ padding: 16 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong style={{ color: colors.ink, fontSize: 15, flex: 1 }}>{invoice.invoiceNumber}</strong>
                      <span style={pill(colors.inkSoft, colors.primaryGhost)}>TEST INVOICE</span>
                      <span
                        style={
                          invoice.status === "PAID"
                            ? pill(colors.success, colors.successTint)
                            : pill(colors.warning, colors.warningTint)
                        }
                      >
                        {invoice.status}
                      </span>
                    </div>
                    <p style={{ ...mutedStyle, fontSize: 13, margin: "6px 0 0" }}>
                      {fmtDay(invoice.periodStart)} – {fmtDay(invoice.periodEnd)} · {rupees(total)} {gstLabel}
                      {invoice.paidMethod ? ` · paid via ${invoice.paidMethod}` : ""}
                    </p>
                    {invoice.status === "PENDING" ? (
                      <div className="sf-row-wrap" style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          onClick={() => void payOnline(invoice.id)}
                          disabled={payingId === invoice.id}
                          style={{ ...primaryBtn, opacity: payingId === invoice.id ? 0.6 : 1 }}
                        >
                          {payingId === invoice.id ? "Starting…" : `Pay ${rupees(total)} online`}
                        </button>
                        {pendingOrders[invoice.id] ? (
                          <button type="button" onClick={() => void checkNow(invoice.id)} className="sf-btn">
                            Check now
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
      <p style={{ ...mutedStyle, fontSize: 13, margin: "16px 0 0" }}>
        Online payments are test-only — no real money moves. Card details are entered on Razorpay&apos;s own
        checkout, never here.
      </p>
    </main>
  );
}
