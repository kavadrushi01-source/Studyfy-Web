import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Scheduled-job authentication (§12.4, §13.4 fourth path): jobs are plain
// HTTP endpoints under /api/v1/internal/jobs/:name, triggered from OUTSIDE
// by a scheduler (GitHub Actions workflow posting hourly) — never by
// in-process timers, which don't fire on a sleeping free-tier host. The
// caller is not a user, not the Platform Owner, not a device: it presents a
// shared secret as X-Cron-Secret, compared in constant time.
// Exactly one middleware on these routes — never stacked with auth/tenant.
export function cronAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.CRON_SECRET ?? "";
  // Fail closed: an unset or short secret means NO job endpoint works —
  // never "no check". 32+ chars per .env.example.
  if (expected.length < 32) {
    res.status(503).json({
      success: false,
      data: null,
      error: { code: "JOBS_DISABLED", message: "Scheduled jobs are not configured." },
      meta: null,
    });
    return;
  }
  const presented = Buffer.from(req.header("x-cron-secret") ?? "");
  const wanted = Buffer.from(expected);
  // timingSafeEqual needs equal lengths — check length first (a wrong
  // length is simply a wrong secret, same 401 either way).
  if (presented.length !== wanted.length || !crypto.timingSafeEqual(presented, wanted)) {
    res.status(401).json({
      success: false,
      data: null,
      error: { code: "UNAUTHENTICATED", message: "Bad job secret." },
      meta: null,
    });
    return;
  }
  next();
}
