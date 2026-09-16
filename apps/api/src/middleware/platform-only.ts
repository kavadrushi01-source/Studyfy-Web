import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

// The Platform Owner sits OUTSIDE the tenant model (spec §5, §13.4):
// school_id IS NULL, so tenantMiddleware (which requires a school_id) can
// never serve them — forcing it through would 401 every valid owner request
// or silently scope a cross-tenant query down to one school. This parallel
// middleware checks the role and hands over the RAW, unscoped client:
// these queries legitimately see every school. Any filtering is an explicit
// where clause in the controller, never the tenant extension.
export function platformOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "PLATFORM_OWNER") {
    res.status(403).json({
      success: false,
      data: null,
      error: { code: "FORBIDDEN", message: "Platform access only." },
      meta: null,
    });
    return;
  }
  req.prisma = prisma;
  next();
}
