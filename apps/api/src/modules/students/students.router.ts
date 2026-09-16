import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";

export const studentsRouter = Router();

// Chain per route: auth -> tenant -> permission -> self-scope. The permission
// grants ACCESS (table-driven); self-scope narrows ROWS for STUDENT/PARENT.
// Minimal probe today (full SIS roster is a Phase 1 module).
studentsRouter.get(
  "/schools/:schoolId/students",
  authMiddleware,
  tenantMiddleware,
  requirePermission("students.read"),
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
    const students = await req.prisma.student.findMany({
      where: req.studentScope ? { id: { in: req.studentScope.studentIds } } : {},
      select: { id: true },
      take: 100,
    });
    res.json({ success: true, data: { students }, error: null, meta: null });
  }),
);

studentsRouter.get(
  "/schools/:schoolId/students/:studentId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("students.read"),
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
    const student = await req.prisma.student.findFirst({
      where: { id: req.params.studentId },
      select: { id: true, sectionId: true, user: { select: { name: true, email: true } } },
    });
    if (!student) {
      res.status(404).json({
        success: false,
        data: null,
        error: { code: "NOT_FOUND", message: "Student not found." },
        meta: null,
      });
      return;
    }
    res.json({ success: true, data: { student }, error: null, meta: null });
  }),
);
