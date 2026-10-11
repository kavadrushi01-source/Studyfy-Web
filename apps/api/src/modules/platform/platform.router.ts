import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { platformOnlyMiddleware } from "../../middleware/platform-only.js";
import { requirePermission } from "../../middleware/rbac.js";
import { AuthError } from "../auth/auth.service.js";
import { listPlatformAuditSchema } from "../audit/audit.schemas.js";
import { listAuditLogs } from "../audit/audit.service.js";
import { getOwnerDashboard } from "../metrics/metrics.service.js";

export const platformRouter = Router();

// Every route here: authMiddleware + platformOnlyMiddleware — NEVER
// tenantMiddleware (spec §13.4). requirePermission on top: the gate checks
// the tenant MODEL (NULL school_id), the table grants the FEATURE.
platformRouter.get(
  "/schools",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.schools.read"),
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
    const schools = await req.prisma.school.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        createdAt: true,
        _count: { select: { users: true, students: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ success: true, data: { schools }, error: null, meta: null });
  }),
);

// Platform Owner board (§7 Phase 1 #9, §8.3 + sequencing note): live
// school counts, schools table data, real signups-per-month analytics.
// Revenue and plan mix are honest zeros/empties until Phase 4 billing
// exists — never projections. Same middleware as every route here:
// platform-only, never tenant-scoped.
platformRouter.get(
  "/dashboard",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.schools.read"),
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
      const dashboard = await getOwnerDashboard(req.prisma);
      res.json({ success: true, data: { dashboard }, error: null, meta: null });
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
        return;
      }
      throw err;
    }
  }),
);

// Platform-wide audit reads (§13.10): the Owner sees every school's rows
// AND the platform-level NULL rows (owner logins live there) — the raw
// client applies no tenant pin. Same cursor pagination + filters as the
// school route, via the shared reader, plus an optional ?schoolId=.
// Same middleware as every route here: platform-only, never tenant-scoped.
platformRouter.get(
  "/audit-logs",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.audit.read"),
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
    const parsed = listPlatformAuditSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid query." },
        meta: null,
      });
      return;
    }
    const { logs, nextCursor } = await listAuditLogs(req.prisma, parsed.data);
    res.json({ success: true, data: { logs, nextCursor }, error: null, meta: null });
  }),
);
