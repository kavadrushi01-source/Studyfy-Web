import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { createExamSchema, enterMarksSchema, savedMarksQuerySchema } from "./exams.schemas.js";
import { createExam, enterMarks, examResults, reportCard, savedMarks } from "./exams.service.js";
import { generateReportCard } from "../../lib/report-card.js";

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

const resultsQuerySchema = z.object({
  top: z.coerce.number().int().min(1).max(500).optional(),
  studentId: z.string().trim().max(40).optional(),
});

// Ranked results (§10, §11): totals + rounded percent + grade + true rank.
// top=K takes the heap path (no full sort); ranks always reflect the whole
// class. Self-scope pins apply exactly like the students routes.
examsRouter.get(
  "/schools/:schoolId/exams/:examId/results",
  authMiddleware,
  tenantMiddleware,
  requirePermission("exams.read"),
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
    const parsed = resultsQuerySchema.safeParse(req.query);
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
      const result = await examResults(
        req.prisma,
        req.params.examId ?? "",
        parsed.data,
        req.studentScope ? req.studentScope.studentIds : null,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendExamsError(res, err);
    }
  }),
);

// Bulk marks entry (teachers.manage holders only; authorship narrows to
// the section's class teacher or Admin — same interim relationship as
// attendance, tightenable to per-subject assignment in Chunk 3).
examsRouter.post(
  "/schools/:schoolId/exams/:examId/marks",
  authMiddleware,
  tenantMiddleware,
  requirePermission("exams.manage"),
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
    const parsed = enterMarksSchema.safeParse(req.body);
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
      const result = await enterMarks(
        req.prisma,
        req.params.examId ?? "",
        { userId: req.user.userId, role: req.user.role },
        parsed.data,
      );
      res.status(200).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendExamsError(res, err);
    }
  }),
);

// Saved marks for one exam subject + section (entry-form prefill —
// boxes open filled with what's already saved instead of blank).
// Same class-teacher-or-admin gate as bulk entry.
examsRouter.get(
  "/schools/:schoolId/exams/:examId/marks",
  authMiddleware,
  tenantMiddleware,
  requirePermission("exams.manage"),
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
    const parsed = savedMarksQuerySchema.safeParse(req.query);
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
      const result = await savedMarks(
        req.prisma,
        req.params.examId ?? "",
        { userId: req.user.userId, role: req.user.role },
        parsed.data,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendExamsError(res, err);
    }
  }),
);

// Per-student report card PDF (§7 Phase 1 #4). Same chain as results —
// params.studentId puts self-scope in charge of WHO may render it
// (own / linked / staff). Attendance % comes from the attendance module,
// rank from the full taker set.
examsRouter.get(
  "/schools/:schoolId/exams/:examId/report-cards/:studentId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("exams.read"),
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
    try {
      const card = await reportCard(req.prisma, req.params.examId ?? "", req.params.studentId ?? "");
      const pdf = await generateReportCard(card);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="report-card-${req.params.examId ?? "exam"}-${req.params.studentId ?? "student"}.pdf"`,
      );
      res.setHeader("Content-Length", String(pdf.length));
      res.send(pdf);
    } catch (err) {
      sendExamsError(res, err);
    }
  }),
);
