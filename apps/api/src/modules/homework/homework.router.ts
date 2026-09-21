import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { postHomeworkSchema } from "./homework.schemas.js";
import { postHomework } from "./homework.service.js";

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
