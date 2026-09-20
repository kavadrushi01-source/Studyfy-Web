"use client";

import { useCallback, useState, type FormEvent } from "react";
import { DataTable } from "../../components/ui/data-table";

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
// Partial blue, Refunded gray). Same token-paste dev workflow until login.
export default function FeesPage() {
  const [schoolId, setSchoolId] = useState("");
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [totals, setTotals] = useState({ outstanding: "0", overdue: "0", count: 0 });
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(
    async (next: { status: string; page: number }) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(next.page), pageSize: "10" });
        if (next.status) {
          params.set("status", next.status);
        }
        const response = await fetch(`${api}/api/v1/schools/${schoolId}/fees/invoices?${params}`, {
          headers: auth,
        });
        const body = (await response.json()) as LedgerResponse;
        if (!response.ok || body.error) {
          setError(body.error?.message ?? `Request failed (${response.status}).`);
          return;
        }
        setRows(body.data.invoices);
        setTotals(body.data.totals);
        setTotalPages(Math.max(1, Math.ceil(body.data.totals.count / 10)));
        setConnected(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [api, schoolId, token],
  );

  function connect(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setPage(1);
    void load({ status: appliedStatus, page: 1 });
  }

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

  const input = { display: "block", width: "100%", margin: "4px 0 12px", padding: 8 } as const;

  return (
    <main style={{ maxWidth: 900, margin: "32px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Fees &amp; Payments</h1>
      {!connected ? (
        <form onSubmit={connect}>
          <label>
            School ID
            <input style={input} value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required />
          </label>
          <label>
            Bearer token (dev only — login screen replaces this)
            <input style={input} value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <button type="submit">Connect</button>
        </form>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              gap: 16,
              marginBottom: 12,
              background: "#fff",
              borderRadius: 14,
              boxShadow: "0 1px 3px rgba(15,23,42,.08)",
              padding: 12,
            }}
          >
            <div>
              <small style={{ color: "#64748B" }}>Outstanding</small>
              <div style={{ fontWeight: 700, fontSize: 18 }}>₹{totals.outstanding}</div>
            </div>
            <div>
              <small style={{ color: "#64748B" }}>Overdue</small>
              <div style={{ fontWeight: 700, fontSize: 18, color: "#DC2626" }}>₹{totals.overdue}</div>
            </div>
            <div>
              <small style={{ color: "#64748B" }}>Invoices</small>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{totals.count}</div>
            </div>
          </div>
          <form onSubmit={applyFilter} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <select
              style={{ flex: 1, padding: 8 }}
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
            <button type="submit">Filter</button>
          </form>
          <DataTable<InvoiceRow>
            columns={[
              { key: "student", label: "Student", render: (r) => r.student.name },
              { key: "head", label: "Fee head", render: (r) => r.structure?.name ?? "—" },
              { key: "amount", label: "Amount", render: (r) => `₹${r.amount}` },
              { key: "paid", label: "Paid", render: (r) => `₹${r.amountPaid}` },
              { key: "due", label: "Due", render: (r) => r.dueDate },
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
        </>
      )}
      {error ? (
        <p role="alert" style={{ color: "#DC2626" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
