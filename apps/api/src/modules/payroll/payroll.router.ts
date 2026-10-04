import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { staffSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import {
  computePayrollSchema,
  decideLeaveSchema,
  listAttendanceSchema,
  listLeavesSchema,
  listPayrollSchema,
  markAttendanceSchema,
  requestLeaveSchema,
} from "./payroll.schemas.js";
import {
  computePayroll,
  decideLeave,
  listAttendance,
  listLeaves,
  listPayroll,
  listStaff,
  markAttendance,
  requestLeave,
} from "./payroll.service.js";

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

function badQuery(res: Response, message: string): void {
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

// staffSelfScope pins non-office callers to their own staff id (null =
// unconstrained office). Absent scope can only mean the middleware was
// never mounted — fail closed rather than list everybody.
function scopeOf(req: Request): string[] | null {
  if (!req.staffScope) {
    return req.user && (req.user.role === "SCHOOL_ADMIN" || req.user.role === "ACCOUNTANT") ? null : [];
  }
  return req.staffScope.staffIds;
}

// Staff roster for office pickers (payroll.manage).
payrollRouter.get(
  "/schools/:schoolId/payroll/staff",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await listStaff(req.prisma);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);

// Mark a day's attendance (payroll.manage): re-marking overwrites.
payrollRouter.post(
  "/schools/:schoolId/payroll/attendance",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = markAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await markAttendance(req.prisma, parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);

// Attendance board (payroll.read): staffSelfScope pins non-office
// callers to their own staff row before the service ever runs.
payrollRouter.get(
  "/schools/:schoolId/payroll/attendance",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.read"),
  staffSelfScope,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      internalError(res);
      return;
    }
    const parsed = listAttendanceSchema.safeParse(req.query);
    if (!parsed.success) {
      badQuery(res, parsed.error.issues[0]?.message ?? "Invalid query.");
      return;
    }
    try {
      const result = await listAttendance(req.prisma, scopeOf(req), parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);

// Request leave (payroll.read): staffSelfScope resolves the caller's
// own id (omitted staffId) and 403s explicit other-ids first.
payrollRouter.post(
  "/schools/:schoolId/payroll/leaves",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.read"),
  staffSelfScope,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      internalError(res);
      return;
    }
    const parsed = requestLeaveSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    const isManager = req.user.role === "SCHOOL_ADMIN" || req.user.role === "ACCOUNTANT";
    if (!req.staffScope && !isManager) {
      sendPayrollError(res, new AuthError(403, "FORBIDDEN", "No staff record is linked to this account."));
      return;
    }
    try {
      const result = await requestLeave(req.prisma, req.staffScope ? (req.staffScope.staffIds[0] ?? null) : null, parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);

// Decide a leave (payroll.manage): approve or reject, once.
payrollRouter.patch(
  "/schools/:schoolId/payroll/leaves/:leaveId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = decideLeaveSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await decideLeave(req.prisma, req.params.leaveId ?? "", parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);

// Leave queue (payroll.read): staffSelfScope pins non-office callers
// to their own requests before the service ever runs.
payrollRouter.get(
  "/schools/:schoolId/payroll/leaves",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.read"),
  staffSelfScope,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      internalError(res);
      return;
    }
    const parsed = listLeavesSchema.safeParse(req.query);
    if (!parsed.success) {
      badQuery(res, parsed.error.issues[0]?.message ?? "Invalid query.");
      return;
    }
    try {
      const result = await listLeaves(req.prisma, scopeOf(req), parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);

// Compute a month (payroll.manage): base − attendance deductions = net;
// recomputing replaces the row.
payrollRouter.post(
  "/schools/:schoolId/payroll/compute",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = computePayrollSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await computePayroll(req.prisma, parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);

// Payroll rows (payroll.read): staffSelfScope pins non-office callers
// to their own staff row before the service ever runs.
payrollRouter.get(
  "/schools/:schoolId/payroll",
  authMiddleware,
  tenantMiddleware,
  requirePermission("payroll.read"),
  staffSelfScope,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      internalError(res);
      return;
    }
    const parsed = listPayrollSchema.safeParse(req.query);
    if (!parsed.success) {
      badQuery(res, parsed.error.issues[0]?.message ?? "Invalid query.");
      return;
    }
    try {
      const result = await listPayroll(
        req.prisma,
        scopeOf(req),
        parsed.data,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendPayrollError(res, err);
    }
  }),
);
