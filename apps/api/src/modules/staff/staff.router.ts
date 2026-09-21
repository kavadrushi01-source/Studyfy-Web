import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { assignSubjectSchema } from "./staff.schemas.js";
import { assignSubject, unassignSubject } from "./staff.service.js";

export const staffRouter = Router();

function sendStaffError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// School Admin only (staff.manage): staff setup incl. qualifications.
// Teacher timetabling + messaging scope read these rows; they never write.
staffRouter.post(
  "/schools/:schoolId/teachers/:staffId/subjects",
  authMiddleware,
  tenantMiddleware,
  requirePermission("staff.manage"),
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
    const parsed = assignSubjectSchema.safeParse(req.body);
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
      const assignment = await assignSubject(req.prisma, req.params.staffId ?? "", parsed.data.subjectId);
      res.status(201).json({ success: true, data: { assignment }, error: null, meta: null });
    } catch (err) {
      sendStaffError(res, err);
    }
  }),
);

staffRouter.get(
  "/schools/:schoolId/teachers/:staffId/subjects",
  authMiddleware,
  tenantMiddleware,
  requirePermission("staff.manage"),
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
    const rows = await req.prisma.teacherSubject.findMany({
      where: { staffId: req.params.staffId },
      select: { id: true, subject: { select: { id: true, name: true } } },
      orderBy: { subject: { name: "asc" } },
    });
    res.json({ success: true, data: { subjects: rows }, error: null, meta: null });
  }),
);

staffRouter.delete(
  "/schools/:schoolId/teachers/:staffId/subjects/:subjectId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("staff.manage"),
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
    try {
      await unassignSubject(req.prisma, req.params.staffId ?? "", req.params.subjectId ?? "");
      res.json({ success: true, data: { deleted: true }, error: null, meta: null });
    } catch (err) {
      sendStaffError(res, err);
    }
  }),
);
