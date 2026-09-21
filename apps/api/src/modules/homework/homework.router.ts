import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { postHomeworkSchema } from "./homework.schemas.js";
import { gradeSubmission, homeworkBoard, postHomework, submitHomework } from "./homework.service.js";

const upload = multer({ storage: multer.memoryStorage() });

export const homeworkRouter = Router();

function sendHomeworkError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// School Admin always; teachers via the subject/section gate in service.
homeworkRouter.post(
  "/schools/:schoolId/homework",
  authMiddleware,
  tenantMiddleware,
  requirePermission("homework.manage"),
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
    const parsed = postHomeworkSchema.safeParse(req.body);
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
      const homework = await postHomework(
        req.prisma,
        { userId: req.user.userId, role: req.user.role },
        parsed.data,
      );
      res.status(201).json({ success: true, data: { homework }, error: null, meta: null });
    } catch (err) {
      sendHomeworkError(res, err);
    }
  }),
);

// Student submission (text and/or Cloudinary file). STUDENT-only key;
// section ownership enforced in service (own section's homework only).
homeworkRouter.post(
  "/schools/:schoolId/homework/:homeworkId/submissions",
  authMiddleware,
  tenantMiddleware,
  requirePermission("homework.submit"),
  upload.single("file"),
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
    const parsed = z.object({ content: z.string().trim().max(10000).optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      const submission = await submitHomework(
        req.prisma,
        req.user.userId,
        req.params.homeworkId ?? "",
        parsed.data.content,
        file
          ? { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, size: file.size }
          : undefined,
      );
      res.status(201).json({ success: true, data: { submission }, error: null, meta: null });
    } catch (err) {
      sendHomeworkError(res, err);
    }
  }),
);

// Teacher grading (same authorship gate as posting).
homeworkRouter.post(
  "/schools/:schoolId/submissions/:submissionId/grade",
  authMiddleware,
  tenantMiddleware,
  requirePermission("homework.grade"),
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
    try {
      const submission = await gradeSubmission(
        req.prisma,
        { userId: req.user.userId, role: req.user.role },
        req.params.submissionId ?? "",
      );
      res.json({ success: true, data: { submission }, error: null, meta: null });
    } catch (err) {
      sendHomeworkError(res, err);
    }
  }),
);

// Board read (homework.read): role-shaped rows — own submissions for
// students/parents, authored-with-counts for teachers, everything for
// admins. Placed FIRST among GETs so no :param route can shadow it (there
// is none today, and this comment keeps it that way).
homeworkRouter.get(
  "/schools/:schoolId/homework",
  authMiddleware,
  tenantMiddleware,
  requirePermission("homework.read"),
  studentSelfScope,
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
    try {
      const result = await homeworkBoard(
        req.prisma,
        { userId: req.user.userId, role: req.user.role },
        req.studentScope ? req.studentScope.studentIds : null,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendHomeworkError(res, err);
    }
  }),
);
