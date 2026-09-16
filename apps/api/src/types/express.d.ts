import type { PrismaClient } from "@prisma/client";
import type { AuthUser } from "../middleware/auth.js";

declare global {
  namespace Express {
    interface Request {
      // Set by authMiddleware from the verified access JWT (never by client input).
      user?: AuthUser;
      // Set per-request: tenantMiddleware injects the tenant-SCOPED client,
      // platformOnlyMiddleware the raw client (§13.4). Typed as the base
      // PrismaClient because the scoping extension only narrows rows at
      // runtime — it doesn't change the query API. Handlers MUST use this,
      // never import the raw singleton, for TENANT_MODELS reads/writes.
      prisma?: PrismaClient;
      schoolId?: string;
    }
  }
}

export {};
