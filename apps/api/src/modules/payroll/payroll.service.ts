import { Prisma, type PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import type { ListPayrollInput } from "./payroll.schemas.js";

// Payroll (§7 Phase 2 #15, basic): monthly salary structures per staffer,
// generated month rows flipped PENDING → PAID. Records only — no money
// moves here, but amounts stay Decimal-exact end to end (§13.6) because
// payroll numbers end up in front of people. Office (payroll.manage)
// runs it; staff with payroll.read see only their own slips, pinned by
// staffId resolved from the login (same idea as studentScope, for staff).
// Cross-tenant safety from tenantMiddleware + TENANT_MODELS, proven by
// the stranger-school test in the suite.
const MANAGERS = new Set(["SCHOOL_ADMIN", "ACCOUNTANT"]);

async function staffIdOf(db: PrismaClient, userId: string): Promise<string | null> {
  const staff = await db.staff.findFirst({ where: { userId }, select: { id: true } });
  return staff?.id ?? null;
}

export async function setSalary(db: PrismaClient, staffId: string, monthlyAmount: string) {
  const staff = await db.staff.findFirst({
    where: { id: staffId },
    select: { id: true, schoolId: true, user: { select: { name: true } } },
  });
  if (!staff) {
    throw new AuthError(404, "STAFF_NOT_FOUND", "Staff member not found in this school.");
  }
  // No upsert: the tenant extension injects schoolId into every where,
  // which breaks unique-where contracts — find-then-write by id instead.
  const existing = await db.salaryStructure.findFirst({ where: { staffId: staff.id }, select: { id: true } });
  const structure = existing
    ? await db.salaryStructure.update({
      where: { id: existing.id },
      data: { monthlyAmount: new Prisma.Decimal(monthlyAmount) },
      select: { monthlyAmount: true },
    })
    : await db.salaryStructure.create({
      data: { schoolId: staff.schoolId, staffId: staff.id, monthlyAmount: new Prisma.Decimal(monthlyAmount) },
      select: { monthlyAmount: true },
    });
  return {
    salary: {
      staffId: staff.id,
      name: staff.user.name,
      monthlyAmount: structure.monthlyAmount.toFixed(2),
    },
  };
}

export async function listSalaries(db: PrismaClient) {
  const rows = await db.staff.findMany({
    select: {
      id: true,
      designation: true,
      user: { select: { name: true, email: true } },
      salaryStructure: { select: { monthlyAmount: true } },
    },
    orderBy: { user: { name: "asc" } },
    take: 500,
  });
  return {
    salaries: rows.map((r) => ({
      staffId: r.id,
      name: r.user.name,
      email: r.user.email,
      designation: r.designation,
      monthlyAmount: r.salaryStructure ? r.salaryStructure.monthlyAmount.toFixed(2) : null,
    })),
  };
}

export async function generateMonth(db: PrismaClient, schoolId: string, month: string) {
  const [structures, staffCount] = await Promise.all([
    db.salaryStructure.findMany({
      select: { staffId: true, monthlyAmount: true },
    }),
    db.staff.count(),
  ]);
  let generated = 0;
  // skipDuplicates: regenerating a month only fills gaps (new hires with
  // structures added after the first run), never duplicates or overwrites.
  if (structures.length > 0) {
    const result = await db.payrollPayment.createMany({
      data: structures.map((s) => ({
        schoolId,
        staffId: s.staffId,
        month,
        amount: s.monthlyAmount,
      })),
      skipDuplicates: true,
    });
    generated = result.count;
  }
  const total = await db.payrollPayment.count({ where: { month } });
  return { month, generated, total, withoutStructure: staffCount - structures.length };
}

export async function markPaid(db: PrismaClient, callerUserId: string, paymentId: string) {
  const payment = await db.payrollPayment.findFirst({
    where: { id: paymentId },
    select: { id: true, status: true },
  });
  if (!payment) {
    throw new AuthError(404, "PAYMENT_NOT_FOUND", "Payroll row not found in this school.");
  }
  if (payment.status === "PAID") {
    throw new AuthError(409, "ALREADY_PAID", "This salary was already marked paid.");
  }
  const updated = await db.payrollPayment.update({
    where: { id: payment.id },
    data: { status: "PAID", paidAt: new Date(), paidBy: callerUserId },
    select: {
      id: true,
      month: true,
      amount: true,
      status: true,
      paidAt: true,
      staff: { select: { id: true, user: { select: { name: true } } } },
      payer: { select: { name: true } },
    },
  });
  return {
    payment: {
      ...updated,
      amount: updated.amount.toFixed(2),
      staff: { id: updated.staff.id, name: updated.staff.user.name },
      payer: updated.payer ? { name: updated.payer.name } : null,
    },
  };
}

export interface PayrollRow {
  id: string;
  month: string;
  amount: string;
  status: string;
  paidAt: Date | null;
  staff: { id: string; name: string };
  payer: { name: string } | null;
}

export async function listPayroll(
  db: PrismaClient,
  caller: { userId: string; role: string },
  input: ListPayrollInput,
): Promise<{
  payments: PayrollRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}> {
  const where: Record<string, unknown> = {};
  if (input.month) {
    where.month = input.month;
  }
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
      return { payments: [], page: input.page, pageSize: input.pageSize, total: 0, totalPages: 1 };
    }
    if (input.staffId && input.staffId !== own) {
      throw new AuthError(403, "FORBIDDEN", "Not your record.");
    }
    where.staffId = own;
  }
  const [total, rows] = await Promise.all([
    db.payrollPayment.count({ where }),
    db.payrollPayment.findMany({
      where,
      select: {
        id: true,
        month: true,
        amount: true,
        status: true,
        paidAt: true,
        staff: { select: { id: true, user: { select: { name: true } } } },
        payer: { select: { name: true } },
      },
      orderBy: [{ month: "desc" }, { staff: { user: { name: "asc" } } }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);
  return {
    payments: rows.map((r) => ({
      id: r.id,
      month: r.month,
      amount: r.amount.toFixed(2),
      status: r.status,
      paidAt: r.paidAt,
      staff: { id: r.staff.id, name: r.staff.user.name },
      payer: r.payer ? { name: r.payer.name } : null,
    })),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}
