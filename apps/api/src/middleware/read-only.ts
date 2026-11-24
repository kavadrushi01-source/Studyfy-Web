import type { NextFunction, Request, Response } from "express";

// Read-only sessions (§13.9, SECURITY_PATTERNS.md §5.3): impersonation
// tokens may GET but never write. Production demo tokens may use only the
// explicitly scoped classroom, messaging, and test-payment write routes.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function demoAcademicWrite(req: Request): boolean {
  if (req.user?.demoAcademicWrites !== true) {
    return false;
  }
  if (req.method === "POST") {
    return (
      /^\/schools\/[^/]+\/attendance$/.test(req.path) ||
      /^\/schools\/[^/]+\/homework$/.test(req.path) ||
      /^\/schools\/[^/]+\/homework\/[^/]+\/submissions$/.test(req.path) ||
      /^\/schools\/[^/]+\/submissions\/[^/]+\/grade$/.test(req.path) ||
      /^\/schools\/[^/]+\/notices$/.test(req.path)
    );
  }
  return (
    (req.method === "PATCH" || req.method === "DELETE") &&
    /^\/schools\/[^/]+\/notices\/[^/]+$/.test(req.path)
  );
}

export function blockWritesWhenReadOnlySession(req: Request, res: Response, next: NextFunction): void {
  const impersonated = Boolean(req.user?.impersonatedBy);
  const demoReadOnly = (req.user as { readOnly?: unknown } | undefined)?.readOnly === true;
  const demoMessageSend =
    demoReadOnly &&
    req.user?.demoMessaging === true &&
    !impersonated &&
    req.method === "POST" &&
    /^\/schools\/[^/]+\/messages$/.test(req.path);
  const demoFeePayment =
    demoReadOnly &&
    req.user?.demoPayments === true &&
    !impersonated &&
    req.method === "POST" &&
    (
      /^\/schools\/[^/]+\/fees\/invoices\/[^/]+\/pay-order$/.test(req.path) ||
      /^\/schools\/[^/]+\/fees\/pay-verify$/.test(req.path)
    );
  const demoAcademic = demoReadOnly && !impersonated && demoAcademicWrite(req);
  if (
    (impersonated || demoReadOnly) &&
    !SAFE_METHODS.has(req.method) &&
    !demoMessageSend &&
    !demoFeePayment &&
    !demoAcademic
  ) {
    res.status(403).json({
      success: false,
      data: null,
      error: { code: "READ_ONLY_SESSION", message: "This session is read-only." },
    });
    return;
  }
  next();
}
