import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { markAttendanceSchema, anomaliesQuerySchema, rosterSchema, summarySchema } from "./attendance.schemas.js";
import { attendanceAnomalies, attendanceSummary, markAttendance, rosterAttendance } from "./attendance.service.js";

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

// Daily roster hydration for the marking screen: the saved statuses for
// one section+day, so reopening a marked day shows its real state instead
// of all-PRESENT defaults. Read side of daily marking - same authorization
// (attendance.mark + the admin/class-teacher check in the service).
attendanceRouter.get(
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
    const parsed = rosterSchema.safeParse(req.query);
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
      const result = await rosterAttendance(
        req.prisma,
        { userId: req.user.userId, role: req.user.role },
        parsed.data,
      );
      res.json({ success: true, data: result, error: null, meta: null });
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
      const school = await req.prisma.school.findFirst({
        where: { id: req.schoolId ?? "" },
        select: { timezone: true },
      });
      // TEACHER summary reads are scoped to their class-teacher sections
      // (§9.1 — the same rule as the list/marks gates). An explicit pupil
      // outside the class is indistinguishable from a missing one (404),
      // matching the fail-closed staff shapes everywhere else.
      let teacherPins: string[] | null = null;
      if (req.user && req.user.role === "TEACHER") {
        const staff = await req.prisma.staff.findFirst({ where: { userId: req.user.userId }, select: { id: true } });
        const rows = staff
          ? await req.prisma.student.findMany({
              where: { section: { classTeacherId: staff.id } },
              select: { id: true },
            })
          : [];
        teacherPins = rows.map((r) => r.id);
        if (parsed.data.studentId && !teacherPins.includes(parsed.data.studentId)) {
          res.status(404).json({
            success: false,
            data: null,
            error: { code: "NOT_FOUND", message: "Student not found." },
            meta: null,
          });
          return;
        }
      }
      const result = await attendanceSummary(
        req.prisma,
        parsed.data,
        req.studentScope
          ? req.studentScope.studentIds
          : teacherPins,
        { timezone: school?.timezone },
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendAttendanceError(res, err);
    }
  }),
);

// Anomaly scan (§7 Phase 3 #18): detection is local sliding-window math,
// Groq only phrases the section summary from de-identified facts. Staff
// analytics — pupils/parents hold attendance.read but are not the
// section's teacher, so the service gate refuses them like roster reads.
attendanceRouter.get(
  "/schools/:schoolId/attendance/anomalies",
  authMiddleware,
  tenantMiddleware,
  requirePermission("attendance.read"),
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
    const parsed = anomaliesQuerySchema.safeParse(req.query);
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
      const result = await attendanceAnomalies(
        req.prisma,
        { userId: req.user.userId, role: req.user.role },
        parsed.data,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendAttendanceError(res, err);
    }
  }),
);
