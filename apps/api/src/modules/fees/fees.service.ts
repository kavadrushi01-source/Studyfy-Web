import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { mailer, MailerUnconfiguredError } from "../../lib/mailer.js";
import { schoolDay } from "../../lib/school-time.js";
import { invalidateAccountantBoards, invalidateActivityFeed, invalidateFeeKpis, invalidateStudentBoards } from "../metrics/metrics.service.js";
import { AuthError } from "../auth/auth.service.js";
import { createRazorpayOrder } from "../../lib/razorpay.js";
import type { CreateStructureInput, GenerateInvoicesInput, ListInvoicesInput, ListPaymentsInput, RecordPaymentInput } from "./fees.schemas.js";

export interface InvoiceLedger {
  invoices: {
    id: string;
    status: string;
    amount: string;
    amountPaid: string;
    outstanding: string;
    dueDate: string;
    student: { id: string; name: string };
    structure: { name: string } | null;
  }[];
  totals: { outstanding: string; overdue: string; count: number };
}

export interface PaymentHistory {
  payments: {
    id: string;
    amount: string;
    method: string;
    paidAt: string;
    invoiceStatus: string;
    student: { id: string; name: string };
  }[];
  total: number;
}

// Payment history (§7 Phase 1 #3): newest first, paged. Same self-scope
// contract as the ledger — pins for STUDENT/PARENT, null for staff.
export async function listPayments(
  db: PrismaClient,
  input: ListPaymentsInput,
  allowedIds: string[] | null,
): Promise<PaymentHistory> {
  if (input.studentId && allowedIds && !allowedIds.includes(input.studentId)) {
    throw new AuthError(403, "FORBIDDEN", "Not your record.");
  }
  const where: Prisma.FeePaymentWhereInput = {
    ...(input.studentId
      ? { invoice: { studentId: input.studentId } }
      : allowedIds
        ? { invoice: { studentId: { in: allowedIds } } }
        : {}),
  };
  const [total, rows] = await Promise.all([
    db.feePayment.count({ where }),
    db.feePayment.findMany({
      where,
      include: {
        invoice: { select: { status: true, student: { select: { id: true, user: { select: { name: true } } } } } },
      },
      orderBy: { paidAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);
  return {
    payments: rows.map((row) => ({
      id: row.id,
      amount: new Prisma.Decimal(row.amount).toFixed(2),
      method: row.method,
      paidAt: row.paidAt.toISOString(),
      invoiceStatus: row.invoice.status,
      student: { id: row.invoice.student.id, name: row.invoice.student.user.name },
    })),
    total,
  };
}

// Ledger read (§7 Phase 1 #3): filterable invoice list + header totals.
// allowedIds = self-scope pins for STUDENT/PARENT (null = staff, full
// school). An explicit studentId outside the pins is rejected, never
// widened. Outstanding uses Decimal throughout (§13.6).
export async function listInvoices(
  db: PrismaClient,
  input: ListInvoicesInput,
  allowedIds: string[] | null,
): Promise<InvoiceLedger> {
  if (input.studentId && allowedIds && !allowedIds.includes(input.studentId)) {
    throw new AuthError(403, "FORBIDDEN", "Not your record.");
  }
  const where: Prisma.FeeInvoiceWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.sectionId ? { student: { sectionId: input.sectionId } } : {}),
    ...(input.studentId
      ? { studentId: input.studentId }
      : allowedIds
        ? { studentId: { in: allowedIds } }
        : {}),
  };
  const [total, rows, open] = await Promise.all([
    db.feeInvoice.count({ where }),
    db.feeInvoice.findMany({
      where,
      include: {
        student: { select: { id: true, user: { select: { name: true } } } },
        structure: { select: { name: true } },
      },
      orderBy: { [input.sort]: input.order },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.feeInvoice.findMany({
      where: { ...where, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
      select: { amount: true, amountPaid: true, status: true },
    }),
  ]);
  let outstanding = new Prisma.Decimal(0);
  let overdue = new Prisma.Decimal(0);
  for (const row of open) {
    const due = new Prisma.Decimal(row.amount).minus(new Prisma.Decimal(row.amountPaid));
    if (due.greaterThan(0)) {
      outstanding = outstanding.plus(due);
      if (row.status === "OVERDUE") {
        overdue = overdue.plus(due);
      }
    }
  }
  return {
    invoices: rows.map((row) => ({
      id: row.id,
      status: row.status,
      amount: row.amount.toString(),
      amountPaid: row.amountPaid.toString(),
      outstanding: new Prisma.Decimal(row.amount).minus(new Prisma.Decimal(row.amountPaid)).toString(),
      dueDate: row.dueDate.toISOString().slice(0, 10),
      student: { id: row.student.id, name: row.student.user.name },
      structure: row.structure ? { name: row.structure.name } : null,
    })),
    totals: { outstanding: outstanding.toString(), overdue: overdue.toString(), count: total },
  };
}

// Fee structure per class (§7 Phase 1 #3): amount + term + category. Runs
// on the tenant-SCOPED client, so the class lookup alone proves "this
// class belongs to this school" — a foreign classId 404s instead of
// attaching a structure to another tenant's class.
export async function createStructure(db: PrismaClient, input: CreateStructureInput) {
  const cls = await db.class.findFirst({ where: { id: input.classId } });
  if (!cls) {
    throw new AuthError(404, "CLASS_NOT_FOUND", "Class not found in this school.");
  }
  if (input.academicYearId) {
    const year = await db.academicYear.findFirst({ where: { id: input.academicYearId } });
    if (!year) {
      throw new AuthError(404, "ACADEMIC_YEAR_NOT_FOUND", "Academic year not found in this school.");
    }
  }
  try {
    return await db.feeStructure.create({
      data: {
        schoolId: cls.schoolId,
        classId: cls.id,
        academicYearId: input.academicYearId,
        name: input.name,
        // String in, Decimal out — the ONLY arithmetic-safe path (§13.6).
        amount: new Prisma.Decimal(input.amount),
        term: input.term,
        category: input.category,
        description: input.description,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AuthError(409, "STRUCTURE_EXISTS", "A structure with this name already exists for the class.");
    }
    throw err;
  }
}

export interface GenerateInvoicesResult {
  generated: number;
  skipped: { studentId: string; reason: string }[];
}

// Bulk-generate invoices from a structure (§7 Phase 1 #3): one invoice per
// student, for the structure's exact amount, PENDING by default. One action
// covers a whole class — never one click per student.
//
// Idempotency ("one invoice per student per term"): a student who already
// holds a live invoice (anything but REFUNDED) for this structure is
// SKIPPED, never double-billed — so re-running the action after admitting
// late joiners only invoices the newcomers. The response says who was
// skipped and why.
export async function generateInvoices(
  db: PrismaClient,
  input: GenerateInvoicesInput,
): Promise<GenerateInvoicesResult> {
  const structure = await db.feeStructure.findFirst({ where: { id: input.structureId } });
  if (!structure) {
    throw new AuthError(404, "STRUCTURE_NOT_FOUND", "Fee structure not found in this school.");
  }

  let studentIds: string[];
  if (input.classId) {
    const cls = await db.class.findFirst({ where: { id: input.classId } });
    if (!cls) {
      throw new AuthError(404, "CLASS_NOT_FOUND", "Class not found in this school.");
    }
    const students = await db.student.findMany({
      where: { section: { classId: cls.id } },
      select: { id: true },
    });
    studentIds = students.map((s) => s.id);
  } else if (input.sectionId) {
    const section = await db.section.findFirst({ where: { id: input.sectionId } });
    if (!section) {
      throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
    }
    const students = await db.student.findMany({ where: { sectionId: section.id }, select: { id: true } });
    studentIds = students.map((s) => s.id);
  } else {
    const students = await db.student.findMany({
      where: { id: { in: input.studentIds ?? [] } },
      select: { id: true },
    });
    const found = new Set(students.map((s) => s.id));
    const missing = (input.studentIds ?? []).filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new AuthError(404, "STUDENT_NOT_FOUND", "One or more students were not found in this school.");
    }
    studentIds = students.map((s) => s.id);
  }

  // Every scoped lookup above already confines to this tenant: foreign ids
  // 404 instead of generating cross-tenant invoices.
  const existing = await db.feeInvoice.findMany({
    where: {
      structureId: structure.id,
      studentId: { in: studentIds },
      status: { not: "REFUNDED" },
    },
    select: { studentId: true, status: true },
  });
  const alreadyBilled = new Map(existing.map((e) => [e.studentId, e.status]));
  const skipped: { studentId: string; reason: string }[] = [];
  const fresh: string[] = [];
  for (const studentId of studentIds) {
    const status = alreadyBilled.get(studentId);
    if (status) {
      skipped.push({ studentId, reason: `Already has a ${status} invoice for this structure.` });
    } else {
      fresh.push(studentId);
    }
  }

  const dueDate = new Date(`${input.dueDate}T00:00:00Z`);
  await db.$transaction(
    fresh.map((studentId) =>
      db.feeInvoice.create({
        data: {
          schoolId: structure.schoolId,
          studentId,
          structureId: structure.id,
          amount: structure.amount,
          amountPaid: 0,
          status: "PENDING",
          dueDate,
        },
      }),
    ),
  );
  // New money owed → pending totals and the status donut are stale (§12.3).
  invalidateAccountantBoards(structure.schoolId);
  invalidateStudentBoards(structure.schoolId);
  return { generated: fresh.length, skipped };
}

export interface RecordPaymentResult {
  invoice: { id: string; amount: string; amountPaid: string; status: string };
  payment: { id: string; amount: string; method: string };
}// Manual counter collection (§7 Phase 1 #3): cash/UPI/card/bank-transfer
// recorded by Admin/Accountant against an invoice. All money math stays in
// Prisma.Decimal — never floats (§13.6). Paid-in-full flips PENDING (or
// PARTIAL) to PAID; anything short stays PARTIAL. Overpayment is rejected:
// the counter cannot collect more than owed.
export async function recordPayment(
  db: PrismaClient,
  invoiceId: string,
  receivedById: string,
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  const invoice = await db.feeInvoice.findFirst({ where: { id: invoiceId } });
  if (!invoice) {
    throw new AuthError(404, "INVOICE_NOT_FOUND", "Invoice not found in this school.");
  }
  if (invoice.status === "PAID" || invoice.status === "REFUNDED") {
    throw new AuthError(409, "INVOICE_SETTLED", `Invoice is already ${invoice.status.toLowerCase()}.`);
  }
  const outstanding = new Prisma.Decimal(invoice.amount).minus(new Prisma.Decimal(invoice.amountPaid));
  const paying = new Prisma.Decimal(input.amount);
  if (paying.greaterThan(outstanding)) {
    throw new AuthError(
      400,
      "OVERPAYMENT",
      `Amount exceeds the outstanding balance of ${outstanding.toFixed(2)}.`,
    );
  }
  const newPaid = new Prisma.Decimal(invoice.amountPaid).plus(paying);
  const settled = newPaid.greaterThanOrEqualTo(new Prisma.Decimal(invoice.amount));

  const [payment, updated] = await db.$transaction([
    db.feePayment.create({
      data: {
        schoolId: invoice.schoolId,
        invoiceId: invoice.id,
        amount: paying,
        method: input.method,
        receivedById,
      },
    }),
    db.feeInvoice.update({
      where: { id: invoice.id },
      data: { amountPaid: newPaid, status: settled ? "PAID" : "PARTIAL" },
    }),
  ]);
  // Money moved → this month's cached collection for this school is stale
  // (§12.3 invalidate on write). Payments also appear in the activities
  // feed, so that goes too (teacher boards surface recent payments only
  // indirectly — no tboard clear needed here).
  invalidateFeeKpis(invoice.schoolId);
  invalidateActivityFeed(invoice.schoolId);
  invalidateAccountantBoards(invoice.schoolId);
  invalidateStudentBoards(invoice.schoolId);
  return {
    invoice: {
      id: updated.id,
      amount: updated.amount.toString(),
      amountPaid: updated.amountPaid.toString(),
      status: updated.status,
    },
    payment: { id: payment.id, amount: payment.amount.toString(), method: payment.method },
  };
}

export interface RunRemindersResult {
  emailed: number;
  skipped: number;
}

// "Today" as a calendar day in the SCHOOL's timezone — schoolDay() in
// lib/school-time.js (§12.7). Re-exported here so existing importers keep
// working; new code imports from the lib directly.
export { schoolDay } from "../../lib/school-time.js";

function addDays(dayStr: string, days: number): string {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(fromStr: string, toStr: string): number {
  const from = new Date(`${fromStr}T00:00:00Z`).getTime();
  const to = new Date(`${toStr}T00:00:00Z`).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

// Fee reminders (§7 Phase 1 #3): invoices due within 3 days (approaching)
// or past due, per the SCHOOL's calendar. One email per guardian per
// invoice; at most one reminder per invoice per local day (lastReminderAt);
// suspended schools skipped. Best-effort delivery like all mailers.
// `now` is injectable so timezone edge cases are unit-testable.
export async function runFeeReminders(
  db: PrismaClient,
  schoolId: string,
  now: Date = new Date(),
): Promise<RunRemindersResult> {
  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school || school.subscriptionStatus === "SUSPENDED") {
    return { emailed: 0, skipped: 0 };
  }
  const today = schoolDay(school.timezone, now);
  const horizon = addDays(today, 3);

  const invoices = await db.feeInvoice.findMany({
    where: {
      schoolId,
      // OVERDUE included: it is precisely the state that needs reminding.
      // (Live demo caught this filter missing it — PENDING-only would let
      // every overdue bill go quiet the moment something marked it so.)
      status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
      dueDate: { lte: new Date(`${horizon}T00:00:00Z`) },
    },
    include: {
      student: {
        select: {
          user: { select: { name: true } },
          guardianLinks: { select: { parent: { select: { name: true, email: true } } } },
        },
      },
    },
  });

  let send: ReturnType<typeof mailer>;
  try {
    send = mailer();
  } catch (err) {
    if (err instanceof MailerUnconfiguredError) {
      console.warn("Skipping fee reminders: SMTP not configured.");
      return { emailed: 0, skipped: invoices.length };
    }
    throw err;
  }

  let emailed = 0;
  let skipped = 0;
  for (const invoice of invoices) {
    if (invoice.lastReminderAt && schoolDay(school.timezone, invoice.lastReminderAt) === today) {
      skipped += 1;
      continue;
    }
    const outstanding = new Prisma.Decimal(invoice.amount).minus(new Prisma.Decimal(invoice.amountPaid));
    if (outstanding.lessThanOrEqualTo(0)) {
      skipped += 1;
      continue;
    }
    const dueStr = invoice.dueDate.toISOString().slice(0, 10);
    const daysOverdue = diffDays(dueStr, today);
    const results = await Promise.allSettled(
      invoice.student.guardianLinks.map((link) =>
        send.sendFeeReminder({
          to: link.parent.email,
          name: link.parent.name,
          studentName: invoice.student.user.name,
          schoolName: school.name,
          amountDue: outstanding.toFixed(2),
          dueDate: dueStr,
          daysOverdue,
        }),
      ),
    );
    let delivered = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        delivered += 1;
      } else {
        console.error("Fee reminder delivery failed:", result.reason);
      }
    }
    emailed += delivered;
    await db.feeInvoice.update({ where: { id: invoice.id }, data: { lastReminderAt: now } });
  }
  return { emailed, skipped };
}

// Webhook lookup foundation (§13.8): resolve a recorded online payment by
// the Razorpay order or payment ID. Returns the payment together with
// the invoice and school it belongs to — the webhook payload identifies
// the transaction, but THIS lookup is what identifies which invoice and
// which school, never any school_id/invoiceId embedded in the payload
// itself. Called by the Phase 2 Razorpay webhook; redelivered events hit
// the UNIQUE constraints (P2002) and are treated as already-processed
// instead of recorded twice.
export async function findPaymentByRazorpayId(
  db: PrismaClient,
  input: { razorpayOrderId?: string; razorpayPaymentId?: string },
): Promise<{
  id: string;
  invoiceId: string;
  schoolId: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  status: string;
} | null> {
  const ors: { razorpayOrderId?: string; razorpayPaymentId?: string }[] = [];
  if (input.razorpayOrderId) {
    ors.push({ razorpayOrderId: input.razorpayOrderId });
  }
  if (input.razorpayPaymentId) {
    ors.push({ razorpayPaymentId: input.razorpayPaymentId });
  }
  if (ors.length === 0) {
    return null;
  }
  return db.feePayment.findFirst({
    where: { OR: ors },
    select: { id: true, invoiceId: true, schoolId: true, razorpayOrderId: true, razorpayPaymentId: true, status: true },
  });
}

export interface OnlinePaymentInit {
  orderId: string;
  keyId: string;
  amount: string;
  currency: string;
  invoiceId: string;
  status: string;
}

// Online payment initiation (§13.8, Phase 2 TEST MODE): the frontend sends
// ONLY the invoice id — never an amount. The server loads the real invoice,
// recomputes the outstanding balance itself, and creates the Razorpay order
// for that exact number, so a tampered client request is structurally
// incapable of paying less than owed. Amounts cross to Razorpay in paise
// (integer) under §13.6 Decimal discipline. Self-scope (§5): with pins
// (STUDENT/PARENT) the invoice's student must be one of them; staff (null
// pins) may initiate for any invoice in the school. The created
// fee_payments row is PENDING (order created, money not moved) — only the
// webhook flips it to CAPTURED. Always creates a fresh order, never reuses
// an old one (amounts may have changed since, checkouts expire).
export async function initiateOnlinePayment(
  db: PrismaClient,
  caller: { userId: string; role: string },
  allowedIds: string[] | null,
  invoiceId: string,
): Promise<OnlinePaymentInit> {
  const invoice = await db.feeInvoice.findFirst({ where: { id: invoiceId } });
  if (!invoice) {
    throw new AuthError(404, "INVOICE_NOT_FOUND", "Invoice not found in this school.");
  }
  if (allowedIds && !allowedIds.includes(invoice.studentId)) {
    throw new AuthError(403, "FORBIDDEN", caller.role === "PARENT" ? "Not your child." : "Not your record.");
  }
  if (invoice.status === "PAID" || invoice.status === "REFUNDED") {
    throw new AuthError(409, "INVOICE_SETTLED", `Invoice is already ${invoice.status.toLowerCase()}.`);
  }
  const outstanding = new Prisma.Decimal(invoice.amount).minus(new Prisma.Decimal(invoice.amountPaid));
  if (outstanding.lessThanOrEqualTo(0)) {
    throw new AuthError(400, "NOTHING_DUE", "Invoice has no outstanding balance.");
  }
  const paise = Math.round(outstanding.toNumber() * 100);
  const order = await createRazorpayOrder(paise, invoice.id, { schoolId: invoice.schoolId, invoiceId: invoice.id });
  const payment = await db.feePayment.create({
    data: {
      schoolId: invoice.schoolId,
      invoiceId: invoice.id,
      amount: outstanding,
      method: "RAZORPAY",
      razorpayOrderId: order.id,
      status: "PENDING",
    },
  });
  return {
    orderId: order.id,
    keyId: order.keyId,
    amount: outstanding.toFixed(2),
    currency: order.currency,
    invoiceId: invoice.id,
    status: payment.status,
  };
}
