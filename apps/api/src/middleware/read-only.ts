import type { NextFunction, Request, Response } from "express";

// Read-only sessions (§13.9, SECURITY_PATTERNS.md §5.3): impersonation
// tokens may GET but never write. Production demo tokens may POST only to
// the relationship-authorized academic messaging route. Mounted right after
// authMiddleware on every tenant route and every platform route.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function blockWritesWhenReadOnlySession(req: Request, res: Response, next: NextFunction): void {
  const impersonated = Boolean(req.user?.impersonatedBy);
  const demoReadOnly = (req.user as { readOnly?: unknown } | undefined)?.readOnly === true;
  const demoMessageSend =
    demoReadOnly &&
    req.user?.demoMessaging === true &&
    !impersonated &&
    req.method === "POST" &&
    /^\/schools\/[^/]+\/messages$/.test(req.path);
  if ((impersonated || demoReadOnly) && !SAFE_METHODS.has(req.method) && !demoMessageSend) {
    res.status(403).json({
      success: false,
      data: null,
      error: { code: "READ_ONLY_SESSION", message: "This session is read-only." },
    });
    return;
  }
  next();
}
