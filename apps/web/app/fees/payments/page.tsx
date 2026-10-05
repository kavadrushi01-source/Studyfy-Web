"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DataTable } from "../../../components/ui/data-table";
import { SkeletonBlocks } from "../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, mutedStyle, pageFrame, pill } from "@/lib/theme";

interface PaymentRow {
  id: string;
  amount: string;
  method: string;
  paidAt: string;
  invoiceStatus: string;
  student: { id: string; name: string };
}

interface PaymentsResponse {
  data: { payments: PaymentRow[]; total: number };
  meta: null;
  error: { code: string; message: string } | null;
}

function inr(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return `₹${amount}`;
  }
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function invoicePill(value: string): React.CSSProperties {
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
}

// Payments & Receipts (§8.4 accountant nav): every payment in scope,
// newest first, each linking its receipt viewer. Same scoping as the
// ledger — accountants/admins see everything, students their own,
// parents their linked children's.
export default function PaymentsPage() {
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (nextPage: number) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(nextPage), pageSize: "10" });
        const response = await apiFetch(`/api/v1/schools/${schoolId}/fees/payments?${params}`);
        const body = (await response.json()) as PaymentsResponse;
        if (!response.ok || body.error) {
          setError(body.error?.message ?? `Request failed (${response.status}).`);
          return;
        }
        setRows(body.data.payments);
        setTotal(body.data.total);
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
    void load(1);
  }, [ready, token, schoolId, apiFetch, load]);

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Payments &amp; Receipts</h1>
        <SkeletonBlocks rows={3} height={52} />
      </main>
    );
  }
  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Payments &amp; Receipts</h1>
        <p style={{ ...mutedStyle, margin: "0 0 12px" }}>Please sign in to view payments.</p>
        <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>Go to login</Link>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={h1Style}>Payments &amp; Receipts</h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>Newest first — open any row&apos;s receipt.</p>
      {error ? <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "0 0 12px" }}>{error}</p> : null}
      <DataTable
          columns={[
            { key: "student", label: "Student", render: (row: PaymentRow) => row.student.name },
            {
              key: "amount",
              label: "Amount",
              render: (row: PaymentRow) => (
                <span style={{ fontWeight: 800, letterSpacing: "-0.02em", color: colors.ink, fontVariantNumeric: "tabular-nums" }}>
                  {inr(row.amount)}
                </span>
              ),
            },
            { key: "method", label: "Method", render: (row: PaymentRow) => row.method },
            {
              key: "paidAt",
              label: "Paid on",
              render: (row: PaymentRow) => {
                const parsed = new Date(row.paidAt);
                return Number.isNaN(parsed.getTime()) ? row.paidAt : parsed.toLocaleDateString("en-GB");
              },
            },
            {
              key: "status",
              label: "Invoice",
              render: (row: PaymentRow) => <span style={invoicePill(row.invoiceStatus)}>{row.invoiceStatus}</span>,
            },
            {
              key: "receipt",
              label: "Receipt",
              render: (row: PaymentRow) => (
                <Link
                  href={`/fees/receipts/${row.id}`}
                  style={{ color: colors.primary, fontWeight: 600, textDecoration: "none" }}
                >
                  Open
                </Link>
              ),
            },
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          sort="paidAt"
          order="desc"
          onSort={() => undefined}
          page={page}
          totalPages={Math.max(1, Math.ceil(total / 10))}
          total={total}
          onPage={(next) => {
            setPage(next);
            void load(next);
          }}
          loading={loading}
          emptyMessage="No payments recorded yet."
        />
    </main>
  );
}
