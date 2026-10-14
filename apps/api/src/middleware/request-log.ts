import type { NextFunction, Request, Response } from "express";

// Request log (§13.9 traceability): every line carries impersonatedBy, so an
// action taken under impersonation is attributable in the logs as well as
// the audit trail. No headers, no bodies, no tokens — method, path, status,
// duration, actor, impersonator. Skipped under NODE_ENV=test (suite-noise
// guard, same precedent as the rate limiters); formatRequestLog is unit-
// tested directly and one production-mode probe proves the wiring.
export interface LoggedRequest {
  method: string;
  path: string;
  user?: { userId?: string; impersonatedBy?: string };
}

export function formatRequestLog(req: LoggedRequest, statusCode: number, durationMs: number): string {
  const userId = req.user?.userId ?? "-";
  const imp = req.user?.impersonatedBy ?? "-";
  return `[api] ${req.method} ${req.path} ${statusCode} ${durationMs}ms user=${userId} imp=${imp}`;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    console.log(formatRequestLog({ method: req.method, path: req.path, user: req.user }, res.statusCode, Date.now() - start));
  });
  next();
}
