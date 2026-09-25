import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { createStructureSchema, generateInvoicesSchema, listInvoicesSchema, recordPaymentSchema } from "./fees.schemas.js";
import { createStructure, generateInvoices, listInvoices, recordPayment, runFeeReminders } from "./fees.service.js";
import { generateFeeReceipt } from "../../lib/receipt.js";

export const feesRouter = Router();

function sendFeesError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// Ledger: every invoice in scope, filterable, with header totals.
// STUDENT/PARENT are pinned to own/linked rows via studentSelfScope;
// staff may narrow by status/section/student. Same §3 contract as students.
feesRouter.get(
  "/schools/:schoolId/fees/invoices",
  authMiddleware,
  tenantMiddleware,
  requirePermission("fees.read"),
  studentSelfScope,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const parsed = listInvoicesSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid query." },
        meta: null,
      });
      return;
    }
    try {
      const result = await listInvoices(
        req.prisma,
        parsed.data,
        req.studentScope ? req.studentScope.studentIds : null,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendFeesError(res, err);
    }
  }),
);

// School Admin / Accountant only (fees.manage). Invoices, payments,
// reminders, and receipts build on structures in later commits.
feesRouter.post(
  "/schools/:schoolId/fees/structures",
  authMiddleware,
  tenantMiddleware,
  requirePermission("fees.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const parsed = createStructureSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      const structure = await createStructure(req.prisma, parsed.data);
      res.status(201).json({ success: true, data: { structure }, error: null, meta: null });
    } catch (err) {
      sendFeesError(res, err);
    }
  }),
);

// Bulk-generate invoices for a whole class / section / list in one action
// (same fees.manage gate — Admin/Accountant only).
feesRouter.post(
  "/schools/:schoolId/fees/invoices/generate",
  authMiddleware,
  tenantMiddleware,
  requirePermission("fees.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const parsed = generateInvoicesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      const result = await generateInvoices(req.prisma, parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendFeesError(res, err);
    }
  }),
);

// Manual payment recording (spec §10): Admin/Accountant records a
// cash/offline payment against an invoice. Online (Razorpay) money is
// Phase 2 and arrives ONLY via webhook — the schema rejects the method
// here so this endpoint can never mark online invoices paid.
feesRouter.post(
  "/schools/:schoolId/fees/invoices/:invoiceId/pay",
  authMiddleware,
  tenantMiddleware,
  requirePermission("fees.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const parsed = recordPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      const result = await recordPayment(req.prisma, req.params.invoiceId ?? "", req.user.userId, parsed.data);
      res.status(200).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendFeesError(res, err);
    }
  }),
);

// PDF receipt for a recorded payment (§7 Phase 1 #3, print-ready per §8.5).
// Counter staff only (fees.manage) — parent-facing receipts arrive with
// online payments in Phase 2. The scoped lookup 404s foreign rows.
feesRouter.get(
  "/schools/:schoolId/fees/payments/:paymentId/receipt",
  authMiddleware,
  tenantMiddleware,
  requirePermission("fees.read"),
  studentSelfScope,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const payment = await req.prisma.feePayment.findFirst({
      where: { id: req.params.paymentId },
      include: {
        invoice: { include: { student: { include: { user: { select: { name: true } } } }, structure: true } },
        school: { select: { name: true, brandColor: true } },
        receivedBy: { select: { name: true } },
      },
    });
    if (!payment) {
      res.status(404).json({
        success: false,
        data: null,
        error: { code: "NOT_FOUND", message: "Payment not found." },
        meta: null,
      });
      return;
    }
    // Students/parents hold fees.read too — narrow to their own rows the
    // same way the ledger does. Staff (no pins) skip this check.
    if (req.studentScope && !req.studentScope.studentIds.includes(payment.invoice.studentId)) {
      res.status(403).json({
        success: false,
        data: null,
        error: { code: "FORBIDDEN", message: "Not your receipt." },
        meta: null,
      });
      return;
    }
    const pdf = await generateFeeReceipt({
      schoolName: payment.school.name,
      brandColor: payment.school.brandColor ?? "#2563EB",
      receiptNo: payment.id.slice(0, 8).toUpperCase(),
      studentName: payment.invoice.student.user.name,
      structureName: payment.invoice.structure?.name ?? "Fee",
      invoiceAmount: payment.invoice.amount.toString(),
      paidNow: payment.amount.toString(),
      totalPaid: payment.invoice.amountPaid.toString(),
      balance: payment.invoice.amount.minus(payment.invoice.amountPaid).toString(),
      status: payment.invoice.status,
      method: payment.method,
      paidAt: payment.paidAt,
      receivedBy: payment.receivedBy?.name ?? "Counter",
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="receipt-${payment.id.slice(0, 8)}.pdf"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.send(pdf);
  }),
);

// Run due/overdue reminders for THIS school (same fees.manage gate).
// Manual trigger today; the §12.4 cron calls this per school, per timezone.
feesRouter.post(
  "/schools/:schoolId/fees/reminders/run",
  authMiddleware,
  tenantMiddleware,
  requirePermission("fees.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const result = await runFeeReminders(req.prisma, req.schoolId ?? "");
    res.status(200).json({ success: true, data: result, error: null, meta: null });
  }),
);
