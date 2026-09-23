import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { getAdminDashboard } from "../metrics/metrics.service.js";

export const dashboardRouter = Router();

// School Admin dashboard bundle (§7 Phase 1 #9, §8.3): KPI cards (Total
// Students, Total Teachers, Total Classes, Fee Collection), Student Growth
// chart data, Recent Activities feed. One call per dashboard load — the
// COUNT/SUM aggregates underneath are cached per §12.3, so this stays one
// cheap call instead of six expensive ones. Admin-only today
// (dashboard.read is granted to SCHOOL_ADMIN alone); other roles gain the
// key as their boards land, one role at a time.
dashboardRouter.get(
  "/schools/:schoolId/dashboard/admin",
  authMiddleware,
  tenantMiddleware,
  requirePermission("dashboard.read"),
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
      const dashboard = await getAdminDashboard(req.prisma, req.schoolId ?? "");
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
