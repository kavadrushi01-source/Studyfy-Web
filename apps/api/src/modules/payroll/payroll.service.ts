import { Prisma, type PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import type {
  ComputePayrollInput,
  DecideLeaveInput,
  ListAttendanceInput,
  ListLeavesInput,
  ListPayrollInput,
  MarkAttendanceInput,
  RequestLeaveInput,
} from "./payroll.schemas.js";

// Payroll (§7 Phase 2 #15, founder schema): staff attendance marks,
// leave requests, and computed monthly rows (base − deductions = net).
// Records only — no money moves here, but amounts stay Decimal-exact
// end to end (§13.6) because payroll numbers end up in front of people.
// Office (payroll.manage) runs it; staff with payroll.read see only
// their own rows, pinned by staffId resolved from the login (same idea
// as studentScope, for staff). Cross-tenant safety from tenantMiddleware
// + TENANT_MODELS, proven by the stranger-school test in the suite.
//
// Deduction policy (no spec formula exists — this is the office rule,
// recomputed fresh on every compute): per-day rate = base / 30;
// ABSENT days in the month minus days covered by APPROVED leave =
// unpaid days; deductions = unpaid × rate (2dp); net = base −
// deductions. Approved leave never deducts. Recomputing a month
// replaces the row — latest compute wins.
const MANAGERS = new Set(["SCHOOL_ADMIN", "ACCOUNTANT"]);

async function staffIdOf(db: PrismaClient, userId: string): Promise<string | null> {
  const staff = await db.staff.findFirst({ where: { userId }, select: { id: true } });
  return staff?.id ?? null;
}

function monthBounds(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

function toISODate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseLeaveDates(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item)) {
      out.push(item);
    }
  }
  return out;
}

export async function listStaff(db: PrismaClient) {
  const rows = await db.staff.findMany({
    select: { id: true, designation: true, user: { select: { name: true, email: true } } },
    orderBy: { user: { name: "asc" } },
    take: 500,
  });
  return {
    staff: rows.map((r) => ({ staffId: r.id, name: r.user.name, email: r.user.email, designation: r.designation })),
  };
}

export async function markAttendance(db: PrismaClient, input: MarkAttendanceInput) {
  const staff = await db.staff.findFirst({
    where: { id: input.staffId },
    select: { id: true, schoolId: true, user: { select: { name: true } } },
  });
  if (!staff) {
    throw new AuthError(404, "STAFF_NOT_FOUND", "Staff member not found in this school.");
  }
  const day = new Date(`${input.date}T00:00:00.000Z`);
  // One mark per staffer per day: re-marking overwrites. Find-then-write
  // (no upsert: the tenant extension breaks unique-where contracts),
  // with a P2002 fallback so two simultaneous marks resolve to one row.
  const existing = await db.staffAttendance.findFirst({
    where: { staffId: staff.id, date: day },
    select: { id: true },
  });
  let row;
  if (existing) {
    row = await db.staffAttendance.update({ where: { id: existing.id }, data: { status: input.status } });
  } else {
    try {
      row = await db.staffAttendance.create({
        data: { schoolId: staff.schoolId, staffId: staff.id, date: day, status: input.status },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
        throw err;
      }
      const won = await db.staffAttendance.findFirstOrThrow({ where: { staffId: staff.id, date: day }, select: { id: true } });
      row = await db.staffAttendance.update({ where: { id: won.id }, data: { status: input.status } });
    }
  }
  return { attendance: { id: row.id, staffId: staff.id, name: staff.user.name, date: input.date, status: row.status } };
}

export async function listAttendance(
  db: PrismaClient,
  caller: { userId: string; role: string },
  input: ListAttendanceInput,
) {
  const where: Record<string, unknown> = {};
  if (MANAGERS.has(caller.role)) {
    if (input.staffId) {
      where.staffId = input.staffId;
    }
  } else {
    const own = await staffIdOf(db, caller.userId);
    if (!own) {
      return { attendance: [] };
    }
    if (input.staffId && input.staffId !== own) {
      throw new AuthError(403, "FORBIDDEN", "Not your record.");
    }
    where.staffId = own;
  }
  if (input.month) {
    const { from, to } = monthBounds(input.month);
    where.date = { gte: from, lt: to };
  }
  const rows = await db.staffAttendance.findMany({
    where,
    select: {
      id: true,
      date: true,
      status: true,
      staff: { select: { id: true, user: { select: { name: true } } } },
    },
    orderBy: [{ date: "desc" }, { staff: { user: { name: "asc" } } }],
    take: 500,
  });
  return {
    attendance: rows.map((r) => ({
      id: r.id,
      staffId: r.staff.id,
      name: r.staff.user.name,
      date: toISODate(r.date),
      status: r.status,
    })),
  };
}

export async function requestLeave(
  db: PrismaClient,
  caller: { userId: string; role: string },
  input: RequestLeaveInput,
) {
  // Staff file for themselves (staffId omitted → resolved from the
  // login); the office files for anyone with an explicit staffer.
  let targetId = input.staffId;
  if (!MANAGERS.has(caller.role)) {
    const own = await staffIdOf(db, caller.userId);
    if (!own) {
      throw new AuthError(403, "FORBIDDEN", "No staff record on this login.");
    }
    if (input.staffId && input.staffId !== own) {
      throw new AuthError(403, "FORBIDDEN", "You can only request leave for yourself.");
    }
    targetId = own;
  }
  if (!targetId) {
    throw new AuthError(400, "VALIDATION_ERROR", "Pick a staffer for this leave.");
  }
  const staff = await db.staff.findFirst({
    where: { id: targetId },
    select: { id: true, schoolId: true, user: { select: { name: true } } },
  });
  if (!staff) {
    throw new AuthError(404, "STAFF_NOT_FOUND", "Staff member not found in this school.");
  }
  const uniqueDates = [...new Set(input.dates)].sort();
  const leave = await db.leaveRequest.create({
    data: { schoolId: staff.schoolId, staffId: staff.id, dates: uniqueDates as unknown as Prisma.InputJsonValue, reason: input.reason },
    select: { id: true, dates: true, reason: true, status: true },
  });
  return {
    leave: {
      id: leave.id,
      staffId: staff.id,
      name: staff.user.name,
      dates: parseLeaveDates(leave.dates),
      reason: leave.reason,
      status: leave.status,
    },
  };
}

export async function decideLeave(db: PrismaClient, leaveId: string, input: DecideLeaveInput) {
  const leave = await db.leaveRequest.findFirst({
    where: { id: leaveId },
    select: { id: true, status: true, staff: { select: { id: true, user: { select: { name: true } } } } },
  });
  if (!leave) {
    throw new AuthError(404, "LEAVE_NOT_FOUND", "Leave request not found in this school.");
  }
  if (leave.status !== "PENDING") {
    throw new AuthError(409, "ALREADY_DECIDED", `This leave is already ${leave.status}.`);
  }
  const updated = await db.leaveRequest.update({
    where: { id: leave.id },
    data: { status: input.status },
    select: { id: true, dates: true, reason: true, status: true },
  });
  return {
    leave: {
      id: updated.id,
      staffId: leave.staff.id,
      name: leave.staff.user.name,
      dates: parseLeaveDates(updated.dates),
      reason: updated.reason,
      status: updated.status,
    },
  };
}

export async function listLeaves(db: PrismaClient, caller: { userId: string; role: string }, input: ListLeavesInput) {
  const where: Record<string, unknown> = {};
  if (input.status) {
    where.status = input.status;
  }
  if (MANAGERS.has(caller.role)) {
    if (input.staffId) {
      where.staffId = input.staffId;
    }
  } else {
    const own = await staffIdOf(db, caller.userId);
    if (!own) {
      return { leaves: [] };
    }
    if (input.staffId && input.staffId !== own) {
      throw new AuthError(403, "FORBIDDEN", "Not your record.");
    }
    where.staffId = own;
  }
  const rows = await db.leaveRequest.findMany({
    where,
    select: {
      id: true,
      dates: true,
      reason: true,
      status: true,
      createdAt: true,
      staff: { select: { id: true, user: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return {
    leaves: rows.map((r) => ({
      id: r.id,
      staffId: r.staff.id,
      name: r.staff.user.name,
      dates: parseLeaveDates(r.dates),
      reason: r.reason,
      status: r.status,
    })),
  };
}

export interface ComputeBreakdown {
  unpaidDays: number;
  absentDays: string[];
  approvedCovered: string[];
  perDayRate: string;
}

export async function computePayroll(db: PrismaClient, input: ComputePayrollInput) {
  const staff = await db.staff.findFirst({
    where: { id: input.staffId },
    select: { id: true, schoolId: true, user: { select: { name: true } } },
  });
  if (!staff) {
    throw new AuthError(404, "STAFF_NOT_FOUND", "Staff member not found in this school.");
  }
  const { from, to } = monthBounds(input.month);
  const [marks, leaves] = await Promise.all([
    db.staffAttendance.findMany({
      where: { staffId: staff.id, date: { gte: from, lt: to } },
      select: { date: true, status: true },
    }),
    db.leaveRequest.findMany({
      where: { staffId: staff.id, status: "APPROVED" },
      select: { dates: true },
    }),
  ]);
  const monthPrefix = `${input.month}-`;
  const covered = new Set<string>();
  for (const leave of leaves) {
    for (const day of parseLeaveDates(leave.dates)) {
      if (day.startsWith(monthPrefix)) {
        covered.add(day);
      }
    }
  }
  const absent = marks.filter((m) => m.status === "ABSENT").map((m) => toISODate(m.date));
  const unpaid = [...new Set(absent.filter((day) => !covered.has(day)))].sort();
  const approvedCovered = [...new Set(absent.filter((day) => covered.has(day)))].sort();
  const base = new Prisma.Decimal(input.baseSalary);
  const perDay = base.div(30);
  const deductions = perDay.mul(unpaid.length).toDecimalPlaces(2);
  const net = base.minus(deductions).toDecimalPlaces(2);
  // Recomputing replaces the row — latest compute wins (no upsert: the
  // tenant extension breaks unique-where contracts).
  const existing = await db.payroll.findFirst({
    where: { staffId: staff.id, month: input.month },
    select: { id: true },
  });
  const row = existing
    ? await db.payroll.update({
      where: { id: existing.id },
      data: { baseSalary: base, deductions, netPay: net },
    })
    : await db.payroll.create({
      data: { schoolId: staff.schoolId, staffId: staff.id, month: input.month, baseSalary: base, deductions, netPay: net },
    });
  const breakdown: ComputeBreakdown = {
    unpaidDays: unpaid.length,
    absentDays: unpaid,
    approvedCovered,
    perDayRate: perDay.toDecimalPlaces(2).toFixed(2),
  };
  return {
    payroll: {
      id: row.id,
      staffId: staff.id,
      name: staff.user.name,
      month: row.month,
      baseSalary: row.baseSalary.toFixed(2),
      deductions: row.deductions.toFixed(2),
      netPay: row.netPay.toFixed(2),
    },
    breakdown,
  };
}

export interface PayrollRow {
  id: string;
  month: string;
  baseSalary: string;
  deductions: string;
  netPay: string;
  staff: { id: string; name: string };
}

export async function listPayroll(
  db: PrismaClient,
  caller: { userId: string; role: string },
  input: ListPayrollInput,
): Promise<{
  payroll: PayrollRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}> {
  const where: Record<string, unknown> = {};
  if (input.month) {
    where.month = input.month;
  }
  if (MANAGERS.has(caller.role)) {
    if (input.staffId) {
      where.staffId = input.staffId;
    }
  } else {
    const own = await staffIdOf(db, caller.userId);
    if (!own) {
      return { payroll: [], page: input.page, pageSize: input.pageSize, total: 0, totalPages: 1 };
    }
    if (input.staffId && input.staffId !== own) {
      throw new AuthError(403, "FORBIDDEN", "Not your record.");
    }
    where.staffId = own;
  }
  const [total, rows] = await Promise.all([
    db.payroll.count({ where }),
    db.payroll.findMany({
      where,
      select: {
        id: true,
        month: true,
        baseSalary: true,
        deductions: true,
        netPay: true,
        staff: { select: { id: true, user: { select: { name: true } } } },
      },
      orderBy: [{ month: "desc" }, { staff: { user: { name: "asc" } } }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);
  return {
    payroll: rows.map((r) => ({
      id: r.id,
      month: r.month,
      baseSalary: r.baseSalary.toFixed(2),
      deductions: r.deductions.toFixed(2),
      netPay: r.netPay.toFixed(2),
      staff: { id: r.staff.id, name: r.staff.user.name },
    })),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}
