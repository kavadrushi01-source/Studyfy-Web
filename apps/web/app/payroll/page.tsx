"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { EmptyState, SkeletonBlocks, UpgradeLocked } from "../../components/ui/shell";
import { isFailure, upgradeLockedMessage } from "../../lib/api";
import { useAuth } from "@/lib/auth-context";
import { colors, h1Style, h2Style, mutedStyle, pageFrame, pill, primaryBtn, secondaryBtn } from "@/lib/theme";

interface StaffOption {
  staffId: string;
  name: string;
  designation: string;
}

interface AttendanceRow {
  id: string;
  staffId: string;
  name: string;
  date: string;
  status: string;
}

interface LeaveRow {
  id: string;
  staffId: string;
  name: string;
  dates: string[];
  reason: string;
  status: string;
}

interface PayrollRow {
  id: string;
  month: string;
  baseSalary: string;
  deductions: string;
  netPay: string;
  staff: { id: string; name: string };
}

interface ApiError {
  error: { code: string; message: string };
}

// Status pills (fees idiom): every workflow state gets a semantic tone.
function statusPill(status: string) {
  switch (status) {
    case "PRESENT":
    case "APPROVED":
      return pill(colors.success, colors.successTint);
    case "ABSENT":
    case "REJECTED":
      return pill(colors.danger, colors.dangerTint);
    case "PENDING":
    case "LATE":
    case "EXCUSED":
      return pill(colors.warning, colors.warningTint);
    default:
      return pill(colors.muted, colors.lineSoft);
  }
}

// Payroll (§7 Phase 2 #15, founder schema): staff attendance marks,
// leave requests, computed monthly rows (base − deductions = net).
// Office (admin/accountant) runs it; staff see only their own rows.
export default function PayrollPage() {
  const { token, schoolId, ready, apiFetch, user } = useAuth();
  const canManage = user?.role === "SCHOOL_ADMIN" || user?.role === "ACCOUNTANT";
  const [error, setError] = useState("");
  // Plan-gate locked state (§16.1): a 403 PLAN_UPGRADE_REQUIRED on the main
  // load parks the server's upgrade message here and the page renders the
  // locked card instead of content or a bare error.
  const [locked, setLocked] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [staff, setStaff] = useState<StaffOption[]>([]);

  const loadStaff = useCallback(async () => {
    if (!schoolId || !canManage) {
      return;
    }
    setLocked(null);
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/staff`);
      const body = (await response.json()) as { data: { staff: StaffOption[] } } | ApiError;
      const upgrade = upgradeLockedMessage(body);
      if (upgrade) {
        setLocked(upgrade);
        return;
      }
      if (!isFailure(response, body)) {
        setStaff(body.data.staff);
      }
    } catch {
      // Roster stays as-is.
    }
  }, [schoolId, apiFetch, canManage]);

  useEffect(() => {
    if (!ready || !token || !schoolId) {
      return;
    }
    void loadStaff();
  }, [ready, token, schoolId, apiFetch, loadStaff]);

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

  if (locked) {
    return (
      <main style={pageFrame}>
        <h1 style={{ ...h1Style, margin: "0 0 12px" }}>Payroll</h1>
        <UpgradeLocked message={locked} />
      </main>
    );
  }

  return (
    <main style={pageFrame}>
      <h1 style={{ ...h1Style, display: "flex", alignItems: "center", gap: 8, margin: "0 0 4px" }}>
        <Wallet size={22} aria-hidden="true" color={colors.primary} /> Payroll
      </h1>
      <p style={{ ...mutedStyle, margin: "8px 0 20px" }}>Attendance, leaves, and computed monthly pay — base minus unpaid days.</p>
      {canManage ? (
        <OfficeDesk
          schoolId={schoolId}
          apiFetch={apiFetch}
          staff={staff}
          notice={notice}
          setNotice={setNotice}
          error={error}
          setError={setError}
        />
      ) : (
        <MyPay schoolId={schoolId} apiFetch={apiFetch} />
      )}
      {notice ? <p style={{ color: colors.success, fontSize: 14, margin: "12px 0 0" }}>{notice}</p> : null}
      {error ? (
        <p role="alert" style={{ color: colors.danger, fontSize: 14, margin: "12px 0 0" }}>
          {error}
        </p>
      ) : null}
    </main>
  );
}

function OfficeDesk({
  schoolId,
  apiFetch,
  staff,
  notice,
  setNotice,
  error,
  setError,
}: {
  schoolId: string;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  staff: StaffOption[];
  notice: string;
  setNotice: (v: string) => void;
  error: string;
  setError: (v: string) => void;
}) {
  void notice;
  void error;
  const [attStaff, setAttStaff] = useState("");
  const [attDate, setAttDate] = useState("");
  const [attStatus, setAttStatus] = useState("PRESENT");
  const [attMonth, setAttMonth] = useState("2026-10");
  const [marks, setMarks] = useState<AttendanceRow[]>([]);
  const [leaveStatus, setLeaveStatus] = useState("PENDING");
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [payStaff, setPayStaff] = useState("");
  const [payMonth, setPayMonth] = useState("2026-10");
  const [payBase, setPayBase] = useState("30000");
  const [lastComputed, setLastComputed] = useState<string>("");
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [rowsMonth, setRowsMonth] = useState("2026-10");
  // Skeleton gate (§8.5): boards never flash false empties on first paint.
  const [booting, setBooting] = useState(true);

  async function openSlip(id: string): Promise<void> {
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/${id}/slip`);
      if (!response.ok) {
        throw new Error("Could not open the slip.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function post(path: string, body: unknown, success: string): Promise<boolean> {    setError("");
    setNotice("");
    try {
      const response = await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const parsed = (await response.json()) as unknown as ApiError;
      if (isFailure(response, parsed)) {
        throw new Error(parsed.error?.message ?? "Request failed.");
      }
      setNotice(success);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      return false;
    }
  }

  const loadMarks = useCallback(
    async (month: string): Promise<void> => {
      try {
        const params = new URLSearchParams({ month });
        const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/attendance?${params}`);
        const body = (await response.json()) as { data: { attendance: AttendanceRow[] } } | ApiError;
        if (!isFailure(response, body)) {
          setMarks(body.data.attendance);
        }
      } catch {
        // Board stays as-is.
      }
    },
    [schoolId, apiFetch],
  );

  const loadLeaves = useCallback(
    async (status: string): Promise<void> => {
      try {
        const params = new URLSearchParams({ status });
        const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/leaves?${params}`);
        const body = (await response.json()) as { data: { leaves: LeaveRow[] } } | ApiError;
        if (!isFailure(response, body)) {
          setLeaves(body.data.leaves);
        }
      } catch {
        // Queue stays as-is.
      }
    },
    [schoolId, apiFetch],
  );

  const loadRows = useCallback(
    async (month: string): Promise<void> => {
      try {
        const params = new URLSearchParams({ month, pageSize: "100" });
        const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll?${params}`);
        const body = (await response.json()) as { data: { payroll: PayrollRow[] } } | ApiError;
        if (!isFailure(response, body)) {
          setRows(body.data.payroll);
        }
      } catch {
        // Rows stay as-is.
      }
    },
    [schoolId, apiFetch],
  );

  useEffect(() => {
    void Promise.all([loadMarks(attMonth), loadLeaves(leaveStatus), loadRows(rowsMonth)]).then(() => setBooting(false));
  }, [schoolId, attMonth, leaveStatus, rowsMonth, loadMarks, loadLeaves, loadRows]);

  async function mark(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!attStaff || !attDate) {
      return;
    }
    const ok = await post(`/api/v1/schools/${schoolId}/payroll/attendance`, { staffId: attStaff, date: attDate, status: attStatus }, "Attendance marked.");
    if (ok) {
      await loadMarks(attMonth);
    }
  }

  async function decide(id: string, status: "APPROVED" | "REJECTED"): Promise<void> {
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/leaves/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not decide the leave.");
      }
      setNotice(`Leave ${status.toLowerCase()}.`);
      await loadLeaves(leaveStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function compute(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!payStaff || !payMonth || !payBase) {
      return;
    }
    setError("");
    setNotice("");
    setLastComputed("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: payStaff, month: payMonth, baseSalary: Number(payBase) }),
      });
      const body = (await response.json()) as {
        data: {
          payroll: { staffId: string; name: string; month: string; baseSalary: string; deductions: string; netPay: string };
          breakdown: { unpaidDays: number; perDayRate: string };
        };
      } | ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not compute payroll.");
      }
      setLastComputed(
        `${body.data.payroll.name} · ${body.data.payroll.month}: base ₹${body.data.payroll.baseSalary} − ₹${body.data.payroll.deductions} (${body.data.breakdown.unpaidDays} unpaid days × ₹${body.data.breakdown.perDayRate}) = net ₹${body.data.payroll.netPay}.`,
      );
      setNotice("Payroll computed.");
      await loadRows(rowsMonth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  return (
    <>
      <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ ...h2Style }}>Mark attendance</h2>
        <form onSubmit={mark} className="sf-row-wrap" style={{ marginBottom: 12 }}>
          <select className="sf-select" style={{ flex: 2, minWidth: 180 }} value={attStaff} onChange={(e) => setAttStaff(e.target.value)} required aria-label="Attendance staffer">
            <option value="">— pick a staffer —</option>
            {staff.map((s) => (
              <option key={s.staffId} value={s.staffId}>
                {s.name} · {s.designation}
              </option>
            ))}
          </select>
          <input className="sf-input" style={{ minWidth: 140 }} value={attDate} onChange={(e) => setAttDate(e.target.value)} placeholder="2026-10-05" aria-label="Attendance date" />
          <select className="sf-select" style={{ minWidth: 130 }} value={attStatus} onChange={(e) => setAttStatus(e.target.value)} aria-label="Attendance status">
            <option value="PRESENT">Present</option>
            <option value="ABSENT">Absent</option>
            <option value="LATE">Late</option>
            <option value="EXCUSED">Excused</option>
          </select>
          <button type="submit" style={primaryBtn}>
            Mark
          </button>
        </form>
        <form onSubmit={(e) => { e.preventDefault(); void loadMarks(attMonth); }} className="sf-row-wrap" style={{ marginBottom: 8 }}>
          <input className="sf-input" style={{ minWidth: 130 }} value={attMonth} onChange={(e) => setAttMonth(e.target.value)} aria-label="Attendance month" />
          <button type="submit" style={secondaryBtn}>
            Show month
          </button>
        </form>
        {booting ? (
          <SkeletonBlocks rows={2} height={40} />
        ) : marks.length === 0 ? (
          <p style={{ ...mutedStyle, fontSize: 13 }}>No marks in this month yet.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {marks.map((m) => (
              <li key={m.id} style={{ fontSize: 13, color: colors.inkSoft, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1 }}>
                  {m.date} · <strong>{m.name}</strong>
                </span>
                <span style={statusPill(m.status)}>{m.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ ...h2Style }}>Leave queue</h2>
        <form onSubmit={(e) => { e.preventDefault(); void loadLeaves(leaveStatus); }} className="sf-row-wrap" style={{ marginBottom: 8 }}>
          <select className="sf-select" style={{ minWidth: 150 }} value={leaveStatus} onChange={(e) => setLeaveStatus(e.target.value)} aria-label="Leave status filter">
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <button type="submit" style={secondaryBtn}>
            Filter leaves
          </button>
        </form>
        {booting ? (
          <SkeletonBlocks rows={2} height={40} />
        ) : leaves.length === 0 ? (
          <p style={{ ...mutedStyle, fontSize: 13 }}>No leave requests here.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {leaves.map((l) => (
              <li key={l.id} style={{ fontSize: 13, color: colors.inkSoft, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1 }}>
                  <strong>{l.name}</strong> · {l.dates.join(", ")} · {l.reason}
                </span>
                <span style={statusPill(l.status)}>{l.status}</span>
                {l.status === "PENDING" ? (
                  <>
                    <button type="button" onClick={() => void decide(l.id, "APPROVED")} style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 12 }}>
                      Approve
                    </button>
                    <button type="button" onClick={() => void decide(l.id, "REJECTED")} style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 12 }}>
                      Reject
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ ...h2Style }}>Compute a month</h2>
        <form onSubmit={compute} className="sf-row-wrap" style={{ marginBottom: 8 }}>
          <select className="sf-select" style={{ flex: 2, minWidth: 180 }} value={payStaff} onChange={(e) => setPayStaff(e.target.value)} required aria-label="Payroll staffer">
            <option value="">— pick a staffer —</option>
            {staff.map((s) => (
              <option key={s.staffId} value={s.staffId}>
                {s.name} · {s.designation}
              </option>
            ))}
          </select>
          <input className="sf-input" style={{ minWidth: 110 }} value={payMonth} onChange={(e) => setPayMonth(e.target.value)} aria-label="Payroll month" />
          <input className="sf-input" style={{ minWidth: 110 }} inputMode="numeric" value={payBase} onChange={(e) => setPayBase(e.target.value)} aria-label="Base salary" />
          <button type="submit" style={primaryBtn}>
            Compute payroll
          </button>
        </form>
        {lastComputed ? <p style={{ fontSize: 13, color: colors.inkSoft }}>{lastComputed}</p> : null}
      </section>

      <section className="sf-card" style={{ padding: 20 }}>
        <h2 style={{ ...h2Style }}>Payroll rows</h2>
        <form onSubmit={(e) => { e.preventDefault(); void loadRows(rowsMonth); }} className="sf-row-wrap" style={{ marginBottom: 8 }}>
          <input className="sf-input" style={{ minWidth: 110 }} value={rowsMonth} onChange={(e) => setRowsMonth(e.target.value)} aria-label="Rows month" />
          <button type="submit" style={secondaryBtn}>
            Filter
          </button>
        </form>
        {booting ? (
          <SkeletonBlocks rows={2} height={40} />
        ) : rows.length === 0 ? (
          <p style={{ ...mutedStyle, fontSize: 13 }}>No payroll rows here yet — compute a month above.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {rows.map((r) => (
              <li key={r.id} style={{ fontSize: 13, color: colors.inkSoft, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1 }}>
                  <strong>{r.staff.name}</strong> · {r.month} · base ₹{r.baseSalary} − ₹{r.deductions} = <strong>₹{r.netPay}</strong>
                </span>
                <button type="button" onClick={() => void openSlip(r.id)} style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 12 }}>
                  Slip
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function MyPay({
  schoolId,
  apiFetch,
}: {
  schoolId: string;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  const [marks, setMarks] = useState<AttendanceRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [month, setMonth] = useState("2026-10");
  const [leaveDates, setLeaveDates] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [booting, setBooting] = useState(true);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ month });
      const [aRes, lRes, pRes] = await Promise.all([
        apiFetch(`/api/v1/schools/${schoolId}/payroll/attendance?${params}`),
        apiFetch(`/api/v1/schools/${schoolId}/payroll/leaves`),
        apiFetch(`/api/v1/schools/${schoolId}/payroll?${params}`),
      ]);
      const [aBody, lBody, pBody] = (await Promise.all([aRes.json(), lRes.json(), pRes.json()])) as [
        { data: { attendance: AttendanceRow[] } } | ApiError,
        { data: { leaves: LeaveRow[] } } | ApiError,
        { data: { payroll: PayrollRow[] } } | ApiError,
      ];
      if (!isFailure(aRes, aBody)) {
        setMarks(aBody.data.attendance);
      }
      if (!isFailure(lRes, lBody)) {
        setLeaves(lBody.data.leaves);
      }
      if (!isFailure(pRes, pBody)) {
        setRows(pBody.data.payroll);
      }
    } catch {
      // Boards stay as-is.
    } finally {
      setBooting(false);
    }
  }, [schoolId, apiFetch, month]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openSlip(id: string): Promise<void> {
    setError("");
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/${id}/slip`);
      if (!response.ok) {
        throw new Error("Could not open the slip.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  async function fileLeave(event: FormEvent<HTMLFormElement>): Promise<void> {    event.preventDefault();
    setError("");
    setNotice("");
    const dates = leaveDates.split(",").map((d) => d.trim()).filter((d) => d.length > 0);
    if (dates.length === 0 || !leaveReason.trim()) {
      return;
    }
    // No staffId sent: the server resolves the caller from their login.
    try {
      const response = await apiFetch(`/api/v1/schools/${schoolId}/payroll/leaves`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dates, reason: leaveReason.trim() }),
      });
      const body = (await response.json()) as unknown as ApiError;
      if (isFailure(response, body)) {
        throw new Error(body.error?.message ?? "Could not file the leave.");
      }
      setLeaveDates("");
      setLeaveReason("");
      setNotice("Leave requested — the office decides.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  return (
    <>
      <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ ...h2Style }}>My month</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
          className="sf-row-wrap"
          style={{ marginBottom: 8 }}
        >
          <input className="sf-input" style={{ minWidth: 110 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="My month" />
          <button type="submit" style={secondaryBtn}>
            Show
          </button>
        </form>
        {booting ? (
          <SkeletonBlocks rows={2} height={40} />
        ) : marks.length === 0 ? (
          <p style={{ ...mutedStyle, fontSize: 13 }}>No marks this month.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {marks.map((m) => (
              <li key={m.id} style={{ fontSize: 13, color: colors.inkSoft, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1 }}>{m.date}</span>
                <span style={statusPill(m.status)}>{m.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sf-card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ ...h2Style }}>My leaves</h2>
        <form onSubmit={fileLeave} className="sf-row-wrap" style={{ marginBottom: 8 }}>
          <input
            className="sf-input"
            style={{ flex: 2, minWidth: 180 }}
            value={leaveDates}
            onChange={(e) => setLeaveDates(e.target.value)}
            placeholder="Dates — e.g. 2026-10-06, 2026-10-07"
            aria-label="Leave dates"
          />
          <input
            className="sf-input"
            style={{ flex: 2, minWidth: 180 }}
            value={leaveReason}
            onChange={(e) => setLeaveReason(e.target.value)}
            placeholder="Reason"
            aria-label="Leave reason"
          />
          <button type="submit" style={primaryBtn}>
            Request leave
          </button>
        </form>
        {booting ? (
          <SkeletonBlocks rows={2} height={40} />
        ) : leaves.length === 0 ? (
          <p style={{ ...mutedStyle, fontSize: 13 }}>No leave requests.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {leaves.map((l) => (
              <li key={l.id} style={{ fontSize: 13, color: colors.inkSoft, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1 }}>
                  {l.dates.join(", ")} · {l.reason}
                </span>
                <span style={statusPill(l.status)}>{l.status}</span>
              </li>
            ))}
          </ul>
        )}
        {notice ? <p style={{ color: colors.success, fontSize: 13 }}>{notice}</p> : null}
        {error ? (
          <p role="alert" style={{ color: colors.danger, fontSize: 13 }}>
            {error}
          </p>
        ) : null}
      </section>

      <section className="sf-card" style={{ padding: 20 }}>
        <h2 style={{ ...h2Style }}>My pay</h2>
        {booting ? (
          <SkeletonBlocks rows={2} height={40} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Wallet size={22} aria-hidden="true" />} title="No pay computed yet" detail="The office computes each month — rows appear here." />
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {rows.map((r) => (
              <li key={r.id} style={{ fontSize: 13, color: colors.inkSoft, display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ flex: 1 }}>
                  {r.month} · base ₹{r.baseSalary} − ₹{r.deductions} = <strong>₹{r.netPay}</strong>
                </span>
                <button type="button" onClick={() => void openSlip(r.id)} style={{ ...secondaryBtn, padding: "4px 10px", fontSize: 12 }}>
                  Slip
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
