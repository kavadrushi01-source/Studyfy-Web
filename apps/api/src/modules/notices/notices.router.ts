import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { createNoticeSchema } from "./notices.schemas.js";
import { publishNotice } from "./notices.service.js";

export const noticesRouter = Router();

function sendNoticeError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// Publish (ADMIN/TEACHER). Email delivery to affected parents/staff
// happens inside; the response reports how many were emailed.
noticesRouter.post(
  "/schools/:schoolId/notices",
  authMiddleware,
  tenantMiddleware,
  requirePermission("notices.write"),
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
    const parsed = createNoticeSchema.safeParse(req.body);
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
      const result = await publishNotice(req.prisma, req.user.userId, parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendNoticeError(res, err);
    }
  }),
);

// Board: staff see everything; STUDENT/PARENT see school-wide plus their
// own class/section (resolved through studentScope — same §3 contract).
noticesRouter.get(
  "/schools/:schoolId/notices",
  authMiddleware,
  tenantMiddleware,
  requirePermission("notices.read"),
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
    let scopeFilter = {};
    if (req.studentScope) {
      const students = await req.prisma.student.findMany({
        where: { id: { in: req.studentScope.studentIds } },
        select: { sectionId: true, section: { select: { classId: true } } },
      });
      const sectionIds = students.map((s) => s.sectionId);
      const classIds = [...new Set(students.map((s) => s.section.classId))];
      scopeFilter = {
        OR: [
          { target: "SCHOOL" },
          { target: "SECTION", sectionId: { in: sectionIds } },
          { target: "CLASS", classId: { in: classIds } },
        ],
      };
    }
    const notices = await req.prisma.notice.findMany({
      where: scopeFilter,
      select: {
        id: true,
        title: true,
        body: true,
        target: true,
        createdAt: true,
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ success: true, data: { notices }, error: null, meta: null });
  }),
);
