"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { DataTable } from "../../../components/ui/data-table";
import { EmptyState } from "../../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";

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
    return null;
  }
  if (!token || !schoolId) {
    return (
      <main style={{ maxWidth: 480, margin: "48px auto", padding: 24, fontFamily: "Inter, system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 22 }}>Payments &amp; Receipts</h1>
        <p style={{ color: "#64748B" }}>Please sign in to view payments.</p>
        <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>Go to Login</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: 28, fontFamily: "Inter, system-ui, sans-serif", background: "#F8FAFC", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A" }}>Payments &amp; Receipts</h1>
      <p style={{ color: "#64748B", margin: "0 0 20px", fontSize: 14 }}>Newest first — open any row&apos;s receipt.</p>
      {error ? <p style={{ color: "#DC2626", fontSize: 14 }}>{error}</p> : null}
      {rows.length === 0 && !loading ? (
        <EmptyState icon={<ReceiptText size={22} aria-hidden="true" />} title="No payments yet" detail="Collections will appear here." />
      ) : (
        <DataTable
          columns={[
            { key: "student", label: "Student", render: (row: PaymentRow) => row.student.name },
            { key: "amount", label: "Amount", render: (row: PaymentRow) => inr(row.amount) },
            { key: "method", label: "Method", render: (row: PaymentRow) => row.method },
            {
              key: "paidAt",
              label: "Paid on",
              render: (row: PaymentRow) => {
                const parsed = new Date(row.paidAt);
                return Number.isNaN(parsed.getTime()) ? row.paidAt : parsed.toLocaleDateString("en-GB");
              },
            },
            { key: "status", label: "Invoice", render: (row: PaymentRow) => row.invoiceStatus },
            {
              key: "receipt",
              label: "Receipt",
              render: (row: PaymentRow) => (
                <Link href={`/fees/receipts/${row.id}`} style={{ color: "#2563EB", fontWeight: 600 }}>
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
      )}
    </main>
  );
}
