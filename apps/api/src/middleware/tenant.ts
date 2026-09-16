import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { scopedPrismaClient } from "../lib/prisma-tenant.js";

function reject(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, data: null, error: { code, message }, meta: null });
}

// Re-derives school_id from the verified JWT (never from client input) and
// hands handlers a Prisma client pre-scoped to it (spec §13.4). Also enforces
// the subscription gate: suspended (or trial-lapsed) schools get no API
// access — data retained, matching §16. Platform Owner routes must NOT use
// this (no school_id) — they get platformOnlyMiddleware instead (§13.4).
export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  const schoolId = req.user?.schoolId;
  if (!schoolId) {
    reject(res, 401, "UNAUTHENTICATED", "Missing school context.");
    return;
  }

  // URL school must match the token — a mismatch is a hand-edited URL or a
  // cross-tenant attempt (this exact check is what the red test exercises).
  if (req.params.schoolId && req.params.schoolId !== schoolId) {
    reject(res, 403, "TENANT_MISMATCH", "Forbidden.");
    return;
  }

  prisma.school
    .findUnique({ where: { id: schoolId } })
    .then((school) => {
      if (!school) {
        reject(res, 401, "UNAUTHENTICATED", "School context is no longer valid.");
        return;
      }
      if (school.subscriptionStatus === "SUSPENDED") {
        reject(
          res,
          403,
          "SCHOOL_SUSPENDED",
          "This school's account is suspended. Please contact your school administrator.",
        );
        return;
      }
      if (school.subscriptionStatus === "TRIAL" && school.trialEndsAt.getTime() < Date.now()) {
        reject(
          res,
          403,
          "TRIAL_EXPIRED",
          "The free trial for this school has ended. Please contact your school administrator.",
        );
        return;
      }
      // The $extends wrapper is runtime-only row narrowing — its delegate
      // types are intentionally incompatible with the base client, so the
      // cast lives HERE, once, where the scoped client is born (never at
      // call sites). req.prisma stays typed as PrismaClient.
      req.prisma = scopedPrismaClient(prisma, schoolId) as unknown as PrismaClient;
      req.schoolId = schoolId;
      next();
    })
    .catch(next);
}
