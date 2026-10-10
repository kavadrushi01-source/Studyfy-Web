import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { prisma } from "../../lib/prisma.js";
import { cronAuthMiddleware } from "../../middleware/cron-auth.js";
import { runFeeRemindersJob } from "./jobs.service.js";

export const jobsRouter = Router();

// Scheduled-job triggers (§12.4, §13.4 fourth path): exactly ONE middleware
// (cronAuthMiddleware) — never auth/tenant/platform/device, never none. The
// secret in X-Cron-Secret IS the authentication; these routes are
// unreachable by users holding JWTs and unusable without the secret. No
// rate limiter: the scheduler calls roughly hourly, and throttling a job
// endpoint would cause exactly the missed-run pileups §12.4 designs around.
const JOBS = {
  "fee-reminders": runFeeRemindersJob,
} as const;

type JobName = keyof typeof JOBS;

function isJobName(name: string): name is JobName {
  return Object.hasOwn(JOBS, name);
}

jobsRouter.post(
  "/internal/jobs/:name",
  cronAuthMiddleware,
  catchAsync(async (req: Request, res: Response) => {
    const name = req.params.name ?? "";
    if (!isJobName(name)) {
      res.status(404).json({
        success: false,
        data: null,
        error: { code: "UNKNOWN_JOB", message: "No such scheduled job." },
        meta: null,
      });
      return;
    }
    // The raw client: jobs fan out per school with their own scoped clients
    // inside the service — the top-level client itself is never used for
    // tenant reads (SECURITY_PATTERNS.md §5.2).
    const result = await JOBS[name](prisma, new Date());
    res.json({ success: true, data: result, error: null, meta: null });
  }),
);
