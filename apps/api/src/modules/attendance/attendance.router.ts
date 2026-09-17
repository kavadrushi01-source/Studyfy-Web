import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { markAttendanceSchema, summarySchema } from "./attendance.schemas.js";
import { attendanceSummary, markAttendance } from "./attendance.service.js";

export const attendanceRouter = Router();

function sendAttendanceError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

attendanceRouter.post(
  "/schools/:schoolId/attendance",
  authMiddleware,
  tenantMiddleware,
  requirePermission("attendance.mark"),
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
    const parsed = markAttendanceSchema.safeParse(req.body);
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
      const result = await markAttendance(
        req.prisma,
        { userId: req.user.userId, role: req.user.role },
        parsed.data,
      );
      res.status(200).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendAttendanceError(res, err);
    }
  }),
);

// Monthly/term % per student (§10). Chain adds studentSelfScope so the pins
// exist; the handler then applies the §3 contract for QUERY ids: explicit
// id outside the pins => 403, omitted id => caller's own/linked rows.
attendanceRouter.get(
  "/schools/:schoolId/attendance/summary",
  authMiddleware,
  tenantMiddleware,
  requirePermission("attendance.read"),
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
    const parsed = summarySchema.safeParse(req.query);
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
      const result = await attendanceSummary(
        req.prisma,
        parsed.data,
        req.studentScope ? req.studentScope.studentIds : null,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendAttendanceError(res, err);
    }
  }),
);
