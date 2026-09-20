import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { createExamSchema } from "./exams.schemas.js";
import { createExam } from "./exams.service.js";

export const examsRouter = Router();

function sendExamsError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// School Admin / Teacher (exams.manage). Marks entry, ranking, and report
// cards build on exams + links in later commits.
examsRouter.post(
  "/schools/:schoolId/exams",
  authMiddleware,
  tenantMiddleware,
  requirePermission("exams.manage"),
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
    const parsed = createExamSchema.safeParse(req.body);
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
      const exam = await createExam(req.prisma, parsed.data);
      res.status(201).json({ success: true, data: { exam }, error: null, meta: null });
    } catch (err) {
      sendExamsError(res, err);
    }
  }),
);

// Schedules are visible to every school role (exams.read) — students need
// to know when exams are; marks stay locked behind entry permissions later.
examsRouter.get(
  "/schools/:schoolId/exams",
  authMiddleware,
  tenantMiddleware,
  requirePermission("exams.read"),
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
    const exams = await req.prisma.exam.findMany({
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        examSubjects: { select: { id: true, maxMarks: true, examDate: true, subject: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ success: true, data: { exams }, error: null, meta: null });
  }),
);
