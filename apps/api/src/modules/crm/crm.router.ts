import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { addNoteSchema, listEnquiriesSchema, updateEnquirySchema } from "./crm.schemas.js";
import { addEnquiryNote, enquiryDetail, listEnquiries, updateEnquiry } from "./crm.service.js";

export const crmRouter = Router();

function sendCrmError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// Pipeline list (office only — crm.read): newest first, filterable by
// pipeline stage, searchable by name/phone/email, with per-stage totals
// for the pipeline header.
crmRouter.get(
  "/schools/:schoolId/enquiries",
  authMiddleware,
  tenantMiddleware,
  requirePermission("crm.read"),
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
    const parsed = listEnquiriesSchema.safeParse(req.query);
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
      const result = await listEnquiries(req.prisma, parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendCrmError(res, err);
    }
  }),
);

// Detail with the follow-up timeline (office only).
crmRouter.get(
  "/schools/:schoolId/enquiries/:enquiryId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("crm.read"),
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
      const result = await enquiryDetail(req.prisma, req.params.enquiryId ?? "");
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendCrmError(res, err);
    }
  }),
);

// Work the pipeline (crm.manage): move stage and/or (un)assign a staffer.
// Stage moves are auto-recorded into the notes timeline.
crmRouter.patch(
  "/schools/:schoolId/enquiries/:enquiryId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("crm.manage"),
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
    const parsed = updateEnquirySchema.safeParse(req.body);
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
      const caller = await req.prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { name: true },
      });
      const result = await updateEnquiry(
        req.prisma,
        { userId: req.user.userId, name: caller?.name ?? "Staff" },
        req.params.enquiryId ?? "",
        parsed.data,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendCrmError(res, err);
    }
  }),
);

// Follow-up note (crm.manage): calls, visits, anything the timeline
// should remember. Author is always the caller.
crmRouter.post(
  "/schools/:schoolId/enquiries/:enquiryId/notes",
  authMiddleware,
  tenantMiddleware,
  requirePermission("crm.manage"),
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
    const parsed = addNoteSchema.safeParse(req.body);
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
      const result = await addEnquiryNote(req.prisma, req.user.userId, req.params.enquiryId ?? "", parsed.data.body);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendCrmError(res, err);
    }
  }),
);
