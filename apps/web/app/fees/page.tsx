"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Clock, ReceiptText, Wallet } from "lucide-react";
import { DataTable } from "../../components/ui/data-table";
import { SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "@/lib/api";
import { loadCheckoutScript, openCheckout } from "@/lib/razorpay-checkout";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, h2Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn } from "@/lib/theme";

interface InvoiceRow {
  id: string;
  status: string;
  amount: string;
  amountPaid: string;
  outstanding: string;
  dueDate: string;
  student: { id: string; name: string };
  structure: { name: string } | null;
}

interface LedgerResponse {
  data: {
    invoices: InvoiceRow[];
    totals: { outstanding: string; overdue: string; count: number };
  };
  meta: null;
  error: { code: string; message: string } | null;
}

// Fee ledger (Phase 1 Chunk 2, spec §7 #3). What you see is decided
// API-side: accountants/admins see everything with header totals, students
// see their own invoices, parents their linked children's. Status pills use
// the semantic colors (§8.2: Paid green, Pending amber, Overdue red,
// Partial blue, Refunded gray). Identity comes from the shared session
// (useAuth).
export default function FeesPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canCollect = user?.role === "SCHOOL_ADMIN" || user?.role === "ACCOUNTANT";
  const [status, setStatus] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [totals, setTotals] = useState({ outstanding: "0", overdue: "0", count: 0 });
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payInvoiceId, setPayInvoiceId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("CASH");
  const [paying, setPaying] = useState(false);
  const [payNotice, setPayNotice] = useState("");
  const [payingOnlineId, setPayingOnlineId] = useState<string | null>(null);
  const [onlineMsg, setOnlineMsg] = useState("");

  const load = useCallback(
    async (next: { status: string; page: number }) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(next.page), pageSize: "10" });
        if (next.status) {
          params.set("status", next.status);
        }
        const response = await apiFetch(`/api/v1/schools/${schoolId}/fees/invoices?${params}`);
        const body = (await response.json()) as LedgerResponse;
        if (!response.ok || body.error) {
          setError(body.error?.message ?? `Request failed (${response.status}).`);
          return;
        }
        setRows(body.data.invoices);
        setTotals(body.data.totals);
        setTotalPages(Math.max(1, Math.ceil(body.data.totals.count / 10)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void load({ status: "", page: 1 });
  }, [ready, token, schoolId, apiFetch, load]);

  function applyFilter(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAppliedStatus(status);
    setPage(1);
    void load({ status, page: 1 });
  }

  function changePage(next: number): void {
    setPage(next);
    void load({ status: appliedStatus, page: next });
  }

  // Counter collection (staff): records a manual CASH/UPI/CARD/BANK_TRANSFER
  // payment against an unpaid invoice. Amounts stay strings end to end
  // (§13.6) — the outstanding hint below is computed in paise integers.
  async function recordPayment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !payInvoiceId) {
      return;
    }
    setPaying(true);
    setError("");
    setPayNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/fees/invoices/${payInvoiceId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: payAmount.trim(), method: payMethod }),
      });
      const body = (await response.json()) as { data: { invoice: { status: string } } } | { error: { message: string } };
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Payment failed.");
      }
      setPayNotice(`Recorded — invoice is now ${body.data.invoice.status}.`);
      setPayInvoiceId("");
      setPayAmount("");
      await load({ status: appliedStatus, page });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setPaying(false);
    }
  }

  function fmtDue(iso: string): string {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString("en-GB");
  }

  // Online payment (§13.8, Phase 2 TEST MODE): one click per invoice sends
  // ONLY the invoice id to pay-order - the server recomputes the amount
  // and returns a Razorpay order. No card form exists anywhere here on
  // purpose: Razorpay's hosted checkout collects card details, raw numbers
  // never touch us. The TEST MODE pill below + the confirmation panel both
  // say so out loud (§13.8).
  async function payOnline(invoiceId: string): Promise<void> {
    if (!schoolId) {
      setError("Please sign in to pay online.");
      return;
    }
    setPayingOnlineId(invoiceId);
    setOnlineMsg("");
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/fees/invoices/${invoiceId}/pay-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as {
        data: { orderId: string; keyId: string; amount: string; currency: string };
      } | { error: { message: string } };
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not start the online payment.");
      }
      await loadCheckoutScript();
      openCheckout({
        key: body.data.keyId,
        orderId: body.data.orderId,
        amountPaise: Math.round(Number(body.data.amount) * 100),
        description: `School fee invoice ending ${invoiceId.slice(-6)}`,
        onSuccess: (payment) => {
          setOnlineMsg(
            `Payment submitted (${payment.razorpay_payment_id}) — the receipt appears here once the school confirms it.`,
          );
          void load({ status: appliedStatus, page });
        },
        onDismiss: () => {
          setOnlineMsg("Payment window closed — no charge was made.");
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setPayingOnlineId(null);
    }
  }

  const statusPill = (value: string): React.CSSProperties => {
    if (value === "PAID") {
      return pill(colors.success, colors.successTint, "#B7E4D0");
    }
    if (value === "PENDING") {
      return pill(colors.warning, colors.warningTint, "#F5E0B5");
    }
    if (value === "OVERDUE") {
      return pill(colors.danger, colors.dangerTint, "#F6CBCB");
    }
    if (value === "PARTIAL") {
      return pill(colors.primary, colors.primaryGhost, "#C7DDFB");
    }
    return pill(colors.muted, "#F1F5F9", colors.line);
  };

  const headerStats = [
    { label: "Outstanding", value: `₹${totals.outstanding}`, color: colors.ink, icon: <Wallet size={16} aria-hidden="true" /> },
    { label: "Overdue", value: `₹${totals.overdue}`, color: colors.danger, icon: <Clock size={16} aria-hidden="true" /> },
    { label: "Invoices", value: String(totals.count), color: colors.ink, icon: <ReceiptText size={16} aria-hidden="true" /> },
  ];

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Fees &amp; Payments</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Fees &amp; Payments</h1>
        <div className="sf-card" style={{ padding: 20 }}>
          <p style={{ color: colors.inkSoft, fontSize: 14, margin: "0 0 8px" }}>Please sign in to view fees.</p>
          <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Fees &amp; Payments</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        Live ledger — header totals plus the invoice table.
      </p>
      <div
        className="sf-card"
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          marginBottom: 12,
          padding: 16,
        }}
      >
        {headerStats.map((stat) => (
          <div key={stat.label} style={{ minWidth: 140 }}>
            <small
              style={{
                color: colors.muted,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.01em",
              }}
            >
              <span style={{ color: colors.faint, display: "inline-flex" }}>{stat.icon}</span> {stat.label}
            </small>
            {loading ? (
              <div className="sf-skeleton" style={{ height: 30, width: 130, borderRadius: 8, background: "#F1F5F9", marginTop: 6 }} />
            ) : (
              <div
                style={{
                  fontWeight: 800,
                  fontSize: 24,
                  letterSpacing: "-0.02em",
                  color: stat.color,
                  marginTop: 4,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {stat.value}
              </div>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={applyFilter} className="sf-row-wrap" style={{ marginBottom: 12 }}>
        <select
          className="sf-select"
          style={{ flex: 1, minWidth: 200 }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="PARTIAL">Partial</option>
          <option value="PAID">Paid</option>
          <option value="OVERDUE">Overdue</option>
          <option value="REFUNDED">Refunded</option>
        </select>
        <button type="submit" style={primaryBtn}>
          Filter
        </button>
      </form>
      <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={h2Style}>Record a payment (counter)</h2>
        {!canCollect ? (
          <p style={{ ...mutedStyle, margin: 0 }}>Only admins and accountants can record payments.</p>
        ) : (
          <>
        <form onSubmit={recordPayment} className="sf-row-wrap">
          <label style={{ ...labelStyle, flex: 2, minWidth: 220 }}>
            <span style={{ color: colors.muted }}>Unpaid invoice</span>
            <select
              className="sf-select"
              value={payInvoiceId}
              onChange={(e) => setPayInvoiceId(e.target.value)}
              required
              aria-label="Unpaid invoice"
            >
              <option value="">— pick an invoice —</option>
              {rows
                .filter((r) => r.status !== "PAID" && r.status !== "REFUNDED")
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.student.name} · {r.structure?.name ?? "Fee"} · ₹{r.amount} (paid ₹{r.amountPaid})
                  </option>
                ))}
            </select>
          </label>
          <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
            <span style={{ color: colors.muted }}>Amount</span>
            <input
              className="sf-input"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder="2500.00"
              required
              inputMode="decimal"
              aria-label="Payment amount"
            />
          </label>
          <label style={{ ...labelStyle, flex: 1, minWidth: 140 }}>
            <span style={{ color: colors.muted }}>Method</span>
            <select
              className="sf-select"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value)}
              aria-label="Payment method"
            >
              <option value="CASH">Cash</option>
              <option value="UPI">UPI</option>
              <option value="CARD">Card</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={paying}
            style={{ ...primaryBtn, opacity: paying ? 0.6 : 1, alignSelf: "flex-end" }}
          >
            {paying ? "Recording…" : "Record payment"}
          </button>
        </form>
        {payNotice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{payNotice}</p> : null}
          </>
        )}
      </section>
      <p style={{ ...mutedStyle, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={pill(colors.warning, colors.warningTint)}>TEST MODE</span>
        Online payments are test-only — no real money moves. Card details are entered on Razorpay&apos;s own checkout, never here.
      </p>
      <DataTable<InvoiceRow>
        columns={[
          { key: "student", label: "Student", render: (r) => r.student.name },
          { key: "head", label: "Fee head", render: (r) => r.structure?.name ?? "—" },
          {
            key: "amount",
            label: "Amount",
            render: (r) => (
              <span style={{ fontWeight: 700, letterSpacing: "-0.02em", color: colors.ink, fontVariantNumeric: "tabular-nums" }}>
                ₹{r.amount}
              </span>
            ),
          },
          {
            key: "paid",
            label: "Paid",
            render: (r) => (
              <span style={{ fontWeight: 600, color: colors.inkSoft, fontVariantNumeric: "tabular-nums" }}>
                ₹{r.amountPaid}
              </span>
            ),
          },
          { key: "due", label: "Due date", render: (r) => fmtDue(r.dueDate) },
          { key: "status", label: "Status", render: (r) => <span style={statusPill(r.status)}>{r.status}</span> },
          {
            key: "online",
            label: "Pay online",
            render: (r) =>
              // Parents only: pupils never pay online and staff record
              // counter payments instead (the pay-order API enforces the
              // same rule — this just keeps the button out of sight).
              user?.role === "PARENT" && Number(r.outstanding) > 0 ? (
                <button
                  type="button"
                  onClick={() => void payOnline(r.id)}
                  disabled={payingOnlineId === r.id}
                  style={{ ...primaryBtn, padding: "6px 14px", fontSize: 13, opacity: payingOnlineId === r.id ? 0.6 : 1 }}
                >
                  {payingOnlineId === r.id ? "Opening…" : "Pay"}
                </button>
              ) : (
                <span style={{ color: colors.muted }}>—</span>
              ),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        sort="dueDate"
        order="asc"
        onSort={() => undefined}
        page={page}
        totalPages={totalPages}
        total={totals.count}
        onPage={changePage}
        loading={loading}
      />
      {onlineMsg ? (
        <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>
          <span style={{ ...pill(colors.warning, colors.warningTint), marginRight: 8 }}>TEST MODE</span>
          {onlineMsg}
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
