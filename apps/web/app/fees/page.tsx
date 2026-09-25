"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Clock, ReceiptText, Wallet } from "lucide-react";
import { DataTable } from "../../components/ui/data-table";
import { SkeletonBlocks } from "../../components/ui/shell";
import { useAuth } from "@/lib/auth-context";

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
  const { token, schoolId, ready, apiFetch } = useAuth();
  const [status, setStatus] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [totals, setTotals] = useState({ outstanding: "0", overdue: "0", count: 0 });
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  function fmtDue(iso: string): string {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString("en-GB");
  }

  const pill = (value: string): React.CSSProperties => {
    const color =
      value === "PAID" ? "#059669" : value === "PENDING" ? "#D97706" : value === "OVERDUE" ? "#DC2626" : value === "PARTIAL" ? "#2563EB" : "#64748B";
    return {
      fontSize: 12,
      padding: "2px 10px",
      borderRadius: 999,
      border: `1px solid ${color}`,
      color,
      whiteSpace: "nowrap",
    };
  };

  const pageStyle: React.CSSProperties = {
    maxWidth: 1120,
    margin: "0 auto",
    padding: 28,
    fontFamily: "Inter, system-ui, sans-serif",
    background: "#F8FAFC",
    minHeight: "100vh",
  };
  const primaryBtn: React.CSSProperties = {
    background: "#2563EB",
    color: "#fff",
    border: 0,
    borderRadius: 10,
    padding: "10px 16px",
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };

  const headerStats = [
    { label: "Outstanding", value: `₹${totals.outstanding}`, color: "#0F172A", icon: <Wallet size={16} aria-hidden="true" /> },
    { label: "Overdue", value: `₹${totals.overdue}`, color: "#DC2626", icon: <Clock size={16} aria-hidden="true" /> },
    { label: "Invoices", value: String(totals.count), color: "#0F172A", icon: <ReceiptText size={16} aria-hidden="true" /> },
  ];

  if (!ready) {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A" }}>Fees &amp; Payments</h1>
        <SkeletonBlocks rows={4} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A" }}>Fees &amp; Payments</h1>
        <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 3px rgba(15,23,42,.08)", padding: 20 }}>
          <p style={{ color: "#334155" }}>Please sign in to view fees.</p>
          <Link href="/login" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 26, margin: "0 0 4px", color: "#0F172A" }}>Fees &amp; Payments</h1>
      <p style={{ color: "#64748B", margin: "0 0 20px", fontSize: 14 }}>
        Live ledger — header totals plus the invoice table.
      </p>
      <div
        style={{
          display: "flex",
          gap: 24,
          flexWrap: "wrap",
          marginBottom: 12,
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 1px 3px rgba(15,23,42,.08)",
          padding: 16,
        }}
      >
        {headerStats.map((stat) => (
          <div key={stat.label}>
            <small style={{ color: "#64748B", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#94A3B8", display: "inline-flex" }}>{stat.icon}</span> {stat.label}
            </small>
            {loading ? (
              <div className="sf-skeleton" style={{ height: 26, width: 110, borderRadius: 6, background: "#F1F5F9", marginTop: 4 }} />
            ) : (
              <div style={{ fontWeight: 700, fontSize: 18, color: stat.color }}>{stat.value}</div>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={applyFilter} className="sf-row-wrap" style={{ marginBottom: 12 }}>
        <select
          style={{ flex: 1, minWidth: 200, padding: 10, borderRadius: 10, border: "1px solid #CBD5E1" }}
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
      <DataTable<InvoiceRow>
        columns={[
          { key: "student", label: "Student", render: (r) => r.student.name },
          { key: "head", label: "Fee head", render: (r) => r.structure?.name ?? "—" },
          { key: "amount", label: "Amount", render: (r) => `₹${r.amount}` },
          { key: "paid", label: "Paid", render: (r) => `₹${r.amountPaid}` },
          { key: "due", label: "Due", render: (r) => fmtDue(r.dueDate) },
          { key: "status", label: "Status", render: (r) => <span style={pill(r.status)}>{r.status}</span> },
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
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
