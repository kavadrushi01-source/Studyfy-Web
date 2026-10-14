import cookieParser from "cookie-parser";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { authRouter } from "./modules/auth/auth.router.js";
import { attendanceRouter } from "./modules/attendance/attendance.router.js";
import { auditRouter } from "./modules/audit/audit.router.js";
import { billingRouter } from "./modules/billing/billing.router.js";
import { biometricRouter } from "./modules/biometric/biometric.router.js";
import { certificatesRouter } from "./modules/certificates/certificates.router.js";
import { crmRouter } from "./modules/crm/crm.router.js";
import { documentsRouter } from "./modules/documents/documents.router.js";
import { examsRouter } from "./modules/exams/exams.router.js";
import { homeworkRouter } from "./modules/homework/homework.router.js";
import { inventoryRouter } from "./modules/inventory/inventory.router.js";
import { jobsRouter } from "./modules/jobs/jobs.router.js";
import { libraryRouter } from "./modules/library/library.router.js";
import { messagesRouter } from "./modules/messages/messages.router.js";
import { payrollRouter } from "./modules/payroll/payroll.router.js";
import { feesRouter } from "./modules/fees/fees.router.js";
import { noticesRouter } from "./modules/notices/notices.router.js";
import { platformRouter } from "./modules/platform/platform.router.js";
import { publicRouter } from "./modules/public/public.router.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.router.js";
import { sectionsRouter } from "./modules/sections/sections.router.js";
import { staffRouter } from "./modules/staff/staff.router.js";
import { supportRouter } from "./modules/support/support.router.js";
import { exportsRouter } from "./modules/exports/exports.router.js";
import { timetableRouter } from "./modules/timetable/timetable.router.js";
import { transportRouter } from "./modules/transport/transport.router.js";
import { studentsRouter } from "./modules/students/students.router.js";
import { applyCors, applyHelmet } from "./middleware/security.js";
import { requestLogger } from "./middleware/request-log.js";

export function createApp(): Express {
  const app = express();
  // Behind Render's proxy in production: trust exactly one hop so
  // rate limiters see the real client IP (spec §12.1, §13).
  app.set("trust proxy", 1);
  applyHelmet(app);
  applyCors(app);
  app.use(
    express.json({
      // Stash the exact raw bytes on every JSON request — the payments
      // webhook (§13.8) HMACs these, since re-serialized JSON would break
      // signatures. Nothing else reads rawBody today.
      verify: (req, _res, buf) => {
        (req as Express.Request).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());
  // Request log (§13.9): method/path/status/duration/actor/impersonator on
  // every line. Mounted before the routers; it reads req.user at response
  // finish, so per-route auth has already run by log time.
  app.use(requestLogger);

  // Blank hello-world route — real modules mount under /api/v1/... per spec §10.
  app.get("/api/v1/hello", (_req, res) => {
    res.json({ success: true, data: { message: "hello from studyfy api" }, error: null, meta: null });
  });

  // Auth is intentionally UNauthenticated + UNscoped (spec §13.4): register
  // creates the school, login/refresh mint the credentials everything else
  // derives school_id from. tenantMiddleware starts after this.
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/platform", platformRouter);
  app.use("/api/v1/public", publicRouter);
  app.use("/api/v1", attendanceRouter);
  app.use("/api/v1", auditRouter);
  app.use("/api/v1", billingRouter);
  app.use("/api/v1", biometricRouter);
  app.use("/api/v1", certificatesRouter);
  app.use("/api/v1", crmRouter);
  app.use("/api/v1", dashboardRouter);
  app.use("/api/v1", documentsRouter);
  app.use("/api/v1", examsRouter);
  app.use("/api/v1", homeworkRouter);
  app.use("/api/v1", inventoryRouter);
  // Scheduled-job triggers (§12.4): cronAuthMiddleware ONLY — mounted here
  // (not under /platform or /schools) so no tenant/platform middleware can
  // ever attach to them by mount-point accident.
  app.use("/api/v1", jobsRouter);
  app.use("/api/v1", libraryRouter);
  app.use("/api/v1", messagesRouter);
  app.use("/api/v1", payrollRouter);
  app.use("/api/v1", staffRouter);
  app.use("/api/v1", supportRouter);
  app.use("/api/v1", exportsRouter);
  app.use("/api/v1", timetableRouter);
  app.use("/api/v1", transportRouter);
  app.use("/api/v1", feesRouter);
  app.use("/api/v1", noticesRouter);
  app.use("/api/v1", sectionsRouter);
  app.use("/api/v1", studentsRouter);

  // Liveness probe (spec §13.5 / RULES.md §4).
  app.get("/health", (_req, res) => {
    res.json({ success: true, data: { ok: true }, error: null, meta: null });
  });

  // Minimal JSON fallback until the centralized errorMiddleware lands
  // (hardening box, spec §13.2). Never leaks stack traces (RULES.md §4).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    if (res.headersSent) {
      return;
    }
    res.status(500).json({
      success: false,
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
      meta: null,
    });
  });

  return app;
}
