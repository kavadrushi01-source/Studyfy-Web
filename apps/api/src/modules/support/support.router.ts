import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { createTicketSchema, listTicketsSchema, schoolMessageSchema } from "./support.schemas.js";
import { createTicket, getTicketDetail, listTickets, postSchoolMessage } from "./support.service.js";

export const supportRouter = Router();

function sendSupportError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({
      success: false,
      data: null,
      error: { code: "CONFLICT", message: "Duplicate record." },
      meta: null,
    });
    return;
  }
  throw err;
}

// Chain per route: auth -> tenant -> permission. Support is a Phase-1
// (ungated) module — the plan gate has no /support entry by design.
// Suspended School Admins CAN reach these paths (§13.4 exception, enforced
// in tenantMiddleware): a suspended school must still ask for help.
supportRouter.post(
  "/schools/:schoolId/support/tickets",
  authMiddleware,
  tenantMiddleware,
  requirePermission("support.write"),
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
    const parsed = createTicketSchema.safeParse(req.body);
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
      const result = await createTicket(req.prisma, req.schoolId ?? "", req.user.userId, parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendSupportError(res, err);
    }
  }),
);

supportRouter.get(
  "/schools/:schoolId/support/tickets",
  authMiddleware,
  tenantMiddleware,
  requirePermission("support.read"),
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
    const parsed = listTicketsSchema.safeParse(req.query);
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
      const tickets = await listTickets(req.prisma, req.schoolId ?? "", parsed.data);
      res.json({ success: true, data: { tickets }, error: null, meta: null });
    } catch (err) {
      sendSupportError(res, err);
    }
  }),
);

supportRouter.get(
  "/schools/:schoolId/support/tickets/:ticketId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("support.read"),
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
      // includeInternal=false: isInternal rows are filtered IN THE QUERY —
      // they never leave the database toward a school (§9.1).
      const ticket = await getTicketDetail(req.prisma, req.schoolId ?? "", req.params.ticketId ?? "", {
        includeInternal: false,
      });
      res.json({ success: true, data: { ticket }, error: null, meta: null });
    } catch (err) {
      sendSupportError(res, err);
    }
  }),
);

supportRouter.post(
  "/schools/:schoolId/support/tickets/:ticketId/messages",
  authMiddleware,
  tenantMiddleware,
  requirePermission("support.write"),
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
    // Strict schema: isInternal/status keys from a school are rejected
    // (400), never silently dropped.
    const parsed = schoolMessageSchema.safeParse(req.body);
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
      const result = await postSchoolMessage(req.prisma, req.schoolId ?? "", req.params.ticketId ?? "", req.user.userId, parsed.data.body);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendSupportError(res, err);
    }
  }),
);
