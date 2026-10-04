import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { generateMonthSchema, listPayrollSchema, setSalarySchema } from "./payroll.schemas.js";
import { generateMonth, listPayroll, listSalaries, markPaid, setSalary } from "./payroll.service.js";

export const payrollRouter = Router();

function sendPayrollError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({
    success: false,
    data: null,
    error: { code: "VALIDATION_ERROR", message },
    meta: null,
  });
}

function internalError(res: Response): void {
  res.status(500).json({
    success: false,
    data: null,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    meta: null,
  });
}

// Salary structures with staff roster (payroll.manage): one row per
// staffer, amount or null when never set.
payrollRouter.get(
  "/schools/:schoolId/payroll/salaries",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await listSalaries(req.prisma);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);

// Set a staffer's monthly salary (payroll.manage).
payrollRouter.post(
  "/schools/:schoolId/payroll/salaries",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = setSalarySchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await setSalary(req.prisma, parsed.data.staffId, parsed.data.monthlyAmount);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);

// Generate a month (payroll.manage): one PENDING row per staffer with a
// structure; regenerating only fills gaps, never duplicates.
payrollRouter.post(
  "/schools/:schoolId/payroll/generate",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = generateMonthSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await generateMonth(req.prisma, req.params.schoolId ?? "", parsed.data.month);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);

// Mark paid (payroll.manage): freezing paidAt + payer; twice is 409.
payrollRouter.post(
  "/schools/:schoolId/payroll/payments/:paymentId/pay",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      internalError(res);
      return;
    }
    try {
      const result = await markPaid(req.prisma, req.user.userId, req.params.paymentId ?? "");
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);

// Payments (payroll.read): managers see everything (month/status/staff
// filters); everyone else is pinned to their own staff row.
payrollRouter.get(
  "/schools/:schoolId/payroll/payments",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      internalError(res);
      return;
    }
    const parsed = listPayrollSchema.safeParse(req.query);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid query.");
      return;
    }
    try {
      const result = await listPayroll(
        req.prisma,
        { userId: req.user.userId, role: req.user.role },
        parsed.data,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);
