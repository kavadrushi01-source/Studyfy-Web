import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { createStructureSchema } from "./fees.schemas.js";
import { createStructure } from "./fees.service.js";

export const feesRouter = Router();

function sendFeesError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// School Admin / Accountant only (fees.manage). Invoices, payments,
// reminders, and receipts build on structures in later commits.
feesRouter.post(
  "/schools/:schoolId/fees/structures",
  authMiddleware,
  tenantMiddleware,
  requirePermission("fees.manage"),
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
    const parsed = createStructureSchema.safeParse(req.body);
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
      const structure = await createStructure(req.prisma, parsed.data);
      res.status(201).json({ success: true, data: { structure }, error: null, meta: null });
    } catch (err) {
      sendFeesError(res, err);
    }
  }),
);
