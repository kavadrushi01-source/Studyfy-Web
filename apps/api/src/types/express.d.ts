import type { PrismaClient } from "@prisma/client";
import type { AuthUser } from "../middleware/auth.js";
import type { ScopedPrismaClient } from "../lib/prisma-tenant.js";

declare global {
  namespace Express {
    interface Request {
      // Set by authMiddleware from the verified access JWT (never by client input).
      user?: AuthUser;
      // Set by tenantMiddleware (scoped) — handlers MUST use this, never the
      // raw client, for anything touching a TENANT_MODELS entry.
      // platformOnlyMiddleware sets the raw PrismaClient instead (§13.4).
      prisma?: ScopedPrismaClient | PrismaClient;
      schoolId?: string;
    }
  }
}

export {};
