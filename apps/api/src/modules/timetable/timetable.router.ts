import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { addSlotSchema, boardQuerySchema, generateTimetableSchema } from "./timetable.schemas.js";
import { addSlot, deleteSlot, generateSectionTimetables, readBoard } from "./timetable.service.js";

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

// Manual add (School Admin only): same invariants as generation, plus the
// qualification check. Genuine exceptions go through qualifications first.
timetableRouter.post(
  "/schools/:schoolId/timetable/slots",
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
    const parsed = addSlotSchema.safeParse(req.body);
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
      const slot = await addSlot(req.prisma, parsed.data);
      res.status(201).json({ success: true, data: { slot }, error: null, meta: null });
    } catch (err) {
      sendTimetableError(res, err);
    }
  }),
);

timetableRouter.delete(
  "/schools/:schoolId/timetable/slots/:slotId",
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
    try {
      await deleteSlot(req.prisma, req.params.slotId ?? "");
      res.json({ success: true, data: { deleted: true }, error: null, meta: null });
    } catch (err) {
      sendTimetableError(res, err);
    }
  }),
);

// Board read (timetable.read for every school role). Exactly one lens per
// call; WHO may use WHICH lens is decided in the service per role.
timetableRouter.get(
  "/schools/:schoolId/timetable",
  authMiddleware,
  tenantMiddleware,
  requirePermission("timetable.read"),
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
    const parsed = boardQuerySchema.safeParse(req.query);
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
      const result = await readBoard(
        req.prisma,
        { userId: req.user.userId, role: req.user.role },
        req.studentScope ? req.studentScope.studentIds : null,
        parsed.data,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTimetableError(res, err);
    }
  }),
);
