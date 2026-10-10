import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { listAuditSchema } from "./audit.schemas.js";

export const auditRouter = Router();

function sendAuditError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// A School Admin reads their OWN school's logs (§13.10). Tenant-scoped by
// construction: tenantMiddleware pins the school, and platform-level rows
// (schoolId NULL — e.g. owner logins) stay invisible to every school, which
// is exactly the fail-closed behavior §9.1 wants. Nobody else holds
// audit.read — teachers, accountants, pupils and parents all 403 here.
// Rows carry actor IDs only (no joined names/emails): the actor may sit
// outside this tenant (a future impersonator), and a scoped join is the
// wrong place to resolve cross-tenant identity. Name resolution belongs to
// the Super Admin panel (Chunk 3), with explicit scoping.
auditRouter.get(
  "/schools/:schoolId/audit-logs",
  authMiddleware,
  tenantMiddleware,
  requirePermission("audit.read"),
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
    if (req.user.role !== "SCHOOL_ADMIN") {
      sendAuditError(res, new AuthError(403, "FORBIDDEN", "Only a School Admin may read audit logs."));
      return;
    }
    const parsed = listAuditSchema.safeParse(req.query);
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
      const { take, entity, action } = parsed.data;
      const logs = await req.prisma.auditLog.findMany({
        where: { ...(entity ? { entity } : {}), ...(action ? { action } : {}) },
        select: {
          id: true,
          schoolId: true,
          actorId: true,
          impersonatedBy: true,
          action: true,
          entity: true,
          entityId: true,
          before: true,
          after: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take,
      });
      res.json({ success: true, data: { logs }, error: null, meta: null });
    } catch (err) {
      sendAuditError(res, err);
    }
  }),
);
