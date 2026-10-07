import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { getAccountantDashboard, getAdminDashboard, getParentDashboard, getStudentDashboard, getTeacherDashboard } from "../metrics/metrics.service.js";
import { getAnalyticsOverview } from "../metrics/analytics.service.js";
import { parentBoardQuerySchema, analyticsQuerySchema } from "./dashboard.schemas.js";

export const dashboardRouter = Router();

function sendDashboardError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// One key (dashboard.read) gates ALL boards; each route additionally
// role-guards its audience, so granting a teacher the key never opens the
// admin bundle and vice versa. Both checks fail closed.
function requireRole(req: Request, role: string): void {
  if (req.user?.role !== role) {
    throw new AuthError(403, "FORBIDDEN", "This dashboard is not for your role.");
  }
}

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
      requireRole(req, "SCHOOL_ADMIN");
      const dashboard = await getAdminDashboard(req.prisma, req.schoolId ?? "");
      res.json({ success: true, data: { dashboard }, error: null, meta: null });
    } catch (err) {
      sendDashboardError(res, err);
    }
  }),
);

// Admin analytics (§7 Phase 3 #19): attendance trend, fee trend, exam
// performance, section table — one cached call per load. Same audience
// gate as the admin bundle (dashboard.read + SCHOOL_ADMIN); teachers and
// accountants keep their own boards.
dashboardRouter.get(
  "/schools/:schoolId/analytics/overview",
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
      requireRole(req, "SCHOOL_ADMIN");
      const parsed = analyticsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          data: null,
          error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid query." },
          meta: null,
        });
        return;
      }
      const analytics = await getAnalyticsOverview(req.prisma, req.schoolId ?? "", parsed.data);
      res.json({ success: true, data: { analytics }, error: null, meta: null });
    } catch (err) {
      sendDashboardError(res, err);
    }
  }),
);

// Teacher "Today" board (§8.3): My Classes, Today's Attendance status,
// Homework Pending, Messages, Today's Timetable, Upcoming Homework/Exams,
// Recent Messages. Quick Actions are pure UI links (no endpoint).
dashboardRouter.get(
  "/schools/:schoolId/dashboard/teacher",
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
      requireRole(req, "TEACHER");
      const dashboard = await getTeacherDashboard(req.prisma, req.schoolId ?? "", req.user.userId);
      res.json({ success: true, data: { dashboard }, error: null, meta: null });
    } catch (err) {
      sendDashboardError(res, err);
    }
  }),
);

// Accountant board (§8.3): Total Collected, Pending Fees, Overdue Fees,
// Total Students; Fee Collection Trend chart, Payment Status donut, Recent
// Transactions table.
dashboardRouter.get(
  "/schools/:schoolId/dashboard/accountant",
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
      requireRole(req, "ACCOUNTANT");
      const dashboard = await getAccountantDashboard(req.prisma, req.schoolId ?? "");
      res.json({ success: true, data: { dashboard }, error: null, meta: null });
    } catch (err) {
      sendDashboardError(res, err);
    }
  }),
);

// Student board (§8.3): Attendance %, Overall Marks, Fees Due, Next Exam,
// Today's Timetable, Recent Marks, Recent Notices. Quick Links are pure UI.
dashboardRouter.get(
  "/schools/:schoolId/dashboard/student",
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
      requireRole(req, "STUDENT");
      const dashboard = await getStudentDashboard(req.prisma, req.schoolId ?? "", req.user.userId);
      res.json({ success: true, data: { dashboard }, error: null, meta: null });
    } catch (err) {
      sendDashboardError(res, err);
    }
  }),
);

// Parent board (§8.3): child selector (?with=<studentId>, default first
// linked child) plus the selected child's full board: KPIs, Child Progress
// chart data, Recent Notices. Quick Actions are pure UI links.
dashboardRouter.get(
  "/schools/:schoolId/dashboard/parent",
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
    const parsed = parentBoardQuerySchema.safeParse(req.query);
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
      requireRole(req, "PARENT");
      const dashboard = await getParentDashboard(req.prisma, req.schoolId ?? "", req.user.userId, parsed.data.with);
      res.json({ success: true, data: { dashboard }, error: null, meta: null });
    } catch (err) {
      sendDashboardError(res, err);
    }
  }),
);
