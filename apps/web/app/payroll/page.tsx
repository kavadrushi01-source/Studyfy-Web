"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { DataTable } from "../../components/ui/data-table";
import { SkeletonBlocks } from "../../components/ui/shell";
import { isFailure } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, labelStyle, mutedStyle, pageFrame, pill, primaryBtn, secondaryBtn } from "@/lib/theme";

interface PayRow {
  id: string;
  month: string;
  amount: string;
  status: string;
  paidAt: string | null;
  staff: { id: string; name: string };
  payer: { name: string } | null;
}

interface SalaryRow {
  staffId: string;
  name: string;
  email: string;
  designation: string;
  monthlyAmount: string | null;
}

interface ApiError {
  error: { code: string; message: string };
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Payroll (§7 Phase 2 #15, basic): monthly salaries per staffer, month
// generation, mark-paid with payer recorded. Records only — no money
// moves here. Office (admin/accountant) runs it; staff see only their
// own slips.
export default function PayrollPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canManage = user?.role === "SCHOOL_ADMIN" || user?.role === "ACCOUNTANT";
  const [rows, setRows] = useState<PayRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState(currentMonth());
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [genMonth, setGenMonth] = useState(currentMonth());
  const [generating, setGenerating] = useState(false);
  const [salaries, setSalaries] = useState<SalaryRow[]>([]);
  const [salaryEdits, setSalaryEdits] = useState<Record<string, string>>({});

  const load = useCallback(
    async (next: { month: string; status: string; page: number }) => {
      if (!schoolId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ page: String(next.page), pageSize: "20" });
        if (next.month.trim()) {
          params.set("month", next.month.trim());
        }
        if (next.status) {
          params.set("status", next.status);
        }
        const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/payments?${params}`);
        const body = (await response.json()) as {
          data: { payments: PayRow[]; total: number; totalPages: number };
        } | ApiError;
        if (isFailure(response, body)) {
          throw new Error(body.error?.message ?? "Failed to load payroll.");
        }
        setRows(body.data.payments);
        setTotal(body.data.total);
        setTotalPages(body.data.totalPages);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error.");
      } finally {
        setLoading(false);
      }
    },
    [schoolId, apiFetch],
  );

  const loadSalaries = useCallback(async () => {
    if (!schoolId) {
      return;
    }
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/salaries`);
      const body = (await response.json()) as { data: { salaries: SalaryRow[] } } | ApiError;
      if (!isFailure(response, body)) {
        setSalaries(body.data.salaries);
      }
    } catch {
      // Salary table stays as-is.
    }
  }, [schoolId, apiFetch]);

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void load({ month: currentMonth(), status: "", page: 1 });
    if (canManage) {
      void loadSalaries();
    }
  }, [ready, token, schoolId, apiFetch, load, loadSalaries, canManage]);

  function applyFilter(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setPage(1);
    void load({ month, status, page: 1 });
  }

  async function generate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!schoolId || !genMonth.trim()) {
      return;
    }
    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: genMonth.trim() }),
      });
      const body = (await response.json()) as {
        data: { generated: number; total: number; withoutStructure: number };
      } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Generation failed.");
      }
      setNotice(
        `Month ready: ${body.data.generated} new row(s), ${body.data.total} total` +
          (body.data.withoutStructure > 0 ? ` — ${body.data.withoutStructure} staffer(s) have no salary set yet.` : "."),
      );
      setMonth(genMonth.trim());
      setPage(1);
      await load({ month: genMonth.trim(), status, page: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveSalary(staffId: string): Promise<void> {
    if (!schoolId) {
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/salaries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, monthlyAmount: salaryEdits[staffId] ?? "" }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not save the salary.");
      }
      setNotice("Salary saved — future months generate with it.");
      await loadSalaries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function markPaid(paymentId: string): Promise<void> {
    if (!schoolId) {
      return;
    }
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/payments/${paymentId}/pay`, {
        method: "POST",
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not mark paid.");
      }
      setNotice("Marked paid.");
      await load({ month, status, page });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  function statusPill(value: string): React.CSSProperties {
    return value === "PAID" ? pill(colors.success, colors.successTint) : pill(colors.warning, colors.warningTint);
  }

  if (!ready) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Payroll</h1>
        <SkeletonBlocks rows={3} height={52} />
      </main>
    );
  }

  if (!token || !schoolId) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Payroll</h1>
        <p style={{ ...mutedStyle, margin: "0 0 12px" }}>Please sign in to view payroll.</p>
        <Link href="/login" style={{ color: colors.primary, fontWeight: 600 }}>
          Go to login
        </Link>
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={{ ...h1Style, display: "flex", alignItems: "center", gap: 8 }}>
        <Wallet size={22} aria-hidden="true" color={colors.primary} /> Payroll
      </h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>
        {canManage ? "Monthly salaries — set, generate the month, mark paid." : "Your salary slips."}
      </p>
      <form onSubmit={applyFilter} className="sf-row-wrap" style={{ marginBottom: 12 }}>
        <label style={{ ...labelStyle, minWidth: 140 }}>
          Month
          <input
            className="sf-input"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="YYYY-MM"
          />
        </label>
        <select
          className="sf-select"
          style={{ minWidth: 140, alignSelf: "flex-end" }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="PAID">Paid</option>
        </select>
        <button type="submit" style={{ ...primaryBtn, alignSelf: "flex-end" }}>
          Filter
        </button>
      </form>
      <DataTable<PayRow>
        columns={[
          { key: "month", label: "Month", render: (r) => <span style={{ fontWeight: 600 }}>{r.month}</span> },
          { key: "staff", label: "Staff", render: (r) => <span>{r.staff.name}</span> },
          {
            key: "amount",
            label: "Amount",
            render: (r) => <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>₹{r.amount}</span>,
          },
          { key: "status", label: "Status", render: (r) => <span style={statusPill(r.status)}>{r.status}</span> },
          {
            key: "paid",
            label: "Paid",
            render: (r) =>
              r.status === "PAID" ? (
                <span style={{ color: colors.inkSoft, fontSize: 13 }}>
                  {r.paidAt ? new Date(r.paidAt).toLocaleDateString("en-GB") : ""} · {r.payer?.name ?? ""}
                </span>
              ) : canManage ? (
                <button type="button" onClick={() => void markPaid(r.id)} style={{ ...primaryBtn, padding: "6px 14px", fontSize: 13 }}>
                  Mark paid
                </button>
              ) : (
                <span style={{ color: colors.muted }}>—</span>
              ),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        sort="month"
        order="desc"
        onSort={() => undefined}
        page={page}
        totalPages={totalPages}
        total={total}
        onPage={(next) => {
          setPage(next);
          void load({ month, status, page: next });
        }}
        loading={loading}
        emptyMessage="No payroll rows here yet — generate the month above."
      />
      {canManage ? (
        <>
          <section className="sf-card" style={{ padding: 20, marginTop: 16 }}>
            <h2 style={{ ...h1Style, fontSize: 18, margin: "0 0 12px" }}>Generate a month</h2>
            <form onSubmit={generate} className="sf-row-wrap">
              <label style={{ ...labelStyle, minWidth: 140 }}>
                Month to generate
                <input
                  className="sf-input"
                  value={genMonth}
                  onChange={(e) => setGenMonth(e.target.value)}
                  placeholder="YYYY-MM"
                />
              </label>
              <button type="submit" disabled={generating} style={{ ...primaryBtn, alignSelf: "flex-end", opacity: generating ? 0.6 : 1 }}>
                {generating ? "Generating…" : "Generate month"}
              </button>
            </form>
          </section>
          <section className="sf-card" style={{ padding: 20, marginTop: 16 }}>
            <h2 style={{ ...h1Style, fontSize: 18, margin: "0 0 4px" }}>Salaries</h2>
            <p style={{ ...mutedStyle, fontSize: 13, margin: "0 0 12px" }}>
              Monthly amount per staffer — future months generate with it. Staff without a salary are skipped.
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {salaries.map((s) => (
                <li
                  key={s.staffId}
                  style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, padding: "8px 0", borderTop: `1px solid ${colors.lineSoft}` }}
                >
                  <span style={{ flex: 1, color: colors.ink, fontWeight: 500 }}>
                    {s.name} <span style={{ color: colors.muted, fontWeight: 400 }}>· {s.designation}</span>
                  </span>
                  <input
                    className="sf-input"
                    style={{ width: 130 }}
                    value={salaryEdits[s.staffId] ?? s.monthlyAmount ?? ""}
                    onChange={(e) => setSalaryEdits((prev) => ({ ...prev, [s.staffId]: e.target.value }))}
                    placeholder="e.g. 45000"
                    inputMode="decimal"
                    aria-label={`Monthly salary for ${s.name}`}
                  />
                  <button type="button" onClick={() => void saveSalary(s.staffId)} style={{ ...secondaryBtn, padding: "6px 14px", fontSize: 13 }}>
                    Save
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
      {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}
