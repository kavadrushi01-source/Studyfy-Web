import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { generateTimetableSchema } from "./timetable.schemas.js";
import { generateSectionTimetables } from "./timetable.service.js";

export const timetableRouter = Router();

function sendTimetableError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// School Admin only (timetable.manage). Always HTTP 200 with placed +
// unresolved — a partial timetable is a RESULT, not an error (spec §10).
timetableRouter.post(
  "/schools/:schoolId/timetable/generate",
  authMiddleware,
  tenantMiddleware,
  requirePermission("timetable.manage"),
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
    const parsed = generateTimetableSchema.safeParse(req.body);
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
      const result = await generateSectionTimetables(req.prisma, parsed.data);
      res.status(200).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTimetableError(res, err);
    }
  }),
);
