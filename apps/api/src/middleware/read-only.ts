import type { NextFunction, Request, Response } from "express";

// Read-only sessions (§13.9, SECURITY_PATTERNS.md §5.3): an impersonation
// token may GET but never write — which also means it can never initiate a
// payment (§13.8). Mounted right after authMiddleware on every tenant route
// and every platform route: in this codebase that means it is invoked at
// the top of tenantMiddleware and platformOnlyMiddleware (both run
// immediately after auth on their routes), so new routes are guarded
// automatically and the check cannot drift per-route.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function blockWritesWhenReadOnlySession(req: Request, res: Response, next: NextFunction): void {
  const readOnly = Boolean(req.user?.impersonatedBy) || Boolean((req.user as { readOnly?: unknown } | undefined)?.readOnly);
  if (readOnly && !SAFE_METHODS.has(req.method)) {
    res.status(403).json({
      success: false,
      data: null,
      error: { code: "READ_ONLY_SESSION", message: "This session is read-only." },
    });
    return;
  }
  next();
}
