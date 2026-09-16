import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

// Table-driven authorization (RULES.md §6): access comes from the
// roles -> permissions join, never from hardcoded `role === ...` branches
// scattered through route code. One indexed existence query per request;
// role/permission rows change only at deploy/seed time, so no cache to go
// stale (caching is a Phase 3 optimization, not Phase 0 correctness).
//
// Fail-closed both ways: unknown role => deny, unknown key (typo in the
// route file) => deny. A misspelled permission can never silently open.
//
// Deliberately NOT replaced by this (documented, not overlooked):
// - platformOnlyMiddleware's PLATFORM_OWNER check: a tenant-MODEL gate
//   (NULL school_id can never pass tenantMiddleware), not a feature grant.
// - selfscope's STUDENT/PARENT branch: selects which ROW-narrowing strategy
//   applies, not whether access is granted — that decision is this check.
// - login's owner lookup: authentication routing (which table shape to find
//   the account in), not authorization.
export function requirePermission(permissionKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.user?.role;
    if (!role) {
      res.status(401).json({
        success: false,
        data: null,
        error: { code: "UNAUTHENTICATED", message: "Authentication required." },
        meta: null,
      });
      return;
    }
    prisma.rolePermission
      .findFirst({
        where: { role: { name: role }, permission: { key: permissionKey } },
        select: { roleId: true },
      })
      .then((grant) => {
        if (!grant) {
          res.status(403).json({
            success: false,
            data: null,
            error: { code: "PERMISSION_DENIED", message: "You do not have permission to perform this action." },
            meta: null,
          });
          return;
        }
        next();
      })
      .catch(next);
  };
}
