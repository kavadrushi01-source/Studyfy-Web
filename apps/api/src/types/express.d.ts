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
      // Set by studentSelfScope for STUDENT/PARENT roles: the ONLY student
      // ids this caller may see. Absent = unconstrained (staff/admin —
      // RBAC refines that separately). List handlers MUST filter by it;
      // detail routes are 403-checked by the middleware itself.
      studentScope?: { studentIds: string[] };
      // Set by teacherSectionScope for TEACHER roles: the ONLY section ids
      // this teacher owns (classTeacherId). Absent = unconstrained.
      // Empty array = fail-closed, sees nothing. List handlers MUST apply it.
      sectionScope?: string[];
      // Set for EVERY JSON request by the body parser (see app.ts): the
      // exact raw bytes received. Webhook signature verification (§13.8)
      // must HMAC these bytes — re-serializing req.body would produce
      // different bytes and break every signature.
      rawBody?: Buffer;
    }
  }
}

export {};
