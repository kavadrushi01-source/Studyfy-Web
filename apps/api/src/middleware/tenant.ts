import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { scopedPrismaClient } from "../lib/prisma-tenant.js";
import { schoolAccess } from "../modules/billing/billing.service.js";
import { featureForPath, planGateAllows, planGateMessage } from "./plan-gate.js";

function reject(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, data: null, error: { code, message }, meta: null });
}

// Re-derives school_id from the verified JWT (never from client input) and
// hands handlers a Prisma client pre-scoped to it (spec §13.4). Then TWO
// billing gates, in order (spec §13.4 + §16.1):
// 1. Access: the date-aware schoolAccess() engine (demo exempt; suspended /
//    lapsed-trial / stale-paid-period blocked; PAST_DUE allowed in grace).
// 2. Feature: the path→tier map (Basic=Phase 1, Standard=+Phase 2,
//    Premium=+Phase 3) — 403 PLAN_UPGRADE_REQUIRED.
// Platform Owner routes must NOT use this (no school_id) — they get
// platformOnlyMiddleware instead (§13.4). The suspended-admin billing
// exception (§13.4) lands with the suspension routes (Chunk 2 step 4).
export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  const schoolId = req.user?.schoolId;
  if (!schoolId) {
    reject(res, 401, "UNAUTHENTICATED", "Missing school context.");
    return;
  }

  // URL school must match the token — a mismatch is a hand-edited URL or a
  // cross-tenant attempt (this exact check is what the red test exercises).
  // The message names the commonest innocent cause (slug pasted instead of
  // ID) because "Forbidden." alone sent a founder in circles.
  if (req.params.schoolId && req.params.schoolId !== schoolId) {
    reject(
      res,
      403,
      "TENANT_MISMATCH",
      "This school does not match your login. Boards want the school ID (from your login screen), not the school slug.",
    );
    return;
  }

  Promise.all([
    prisma.school.findUnique({ where: { id: schoolId } }),
    prisma.subscription.findUnique({ where: { schoolId } }),
  ])
    .then(([school, subscription]) => {
      if (!school) {
        reject(res, 401, "UNAUTHENTICATED", "School context is no longer valid.");
        return;
      }
      const access = schoolAccess(school, subscription);
      if (!access.allowed) {
        // Suspended-school exception (§13.4): a suspended School Admin can
        // still reach ONLY the billing routes (pay + reactivate) — every
        // other path, and every other role, stays blocked. The billing
        // router enforces its own billing.read key on top, so this is a
        // narrowed doorway, not an open one. Support tickets join the
        // allowlist with Chunk 4 (no ticket routes exist yet to allow).
        if (
          access.code === "SCHOOL_SUSPENDED" &&
          req.user?.role === "SCHOOL_ADMIN" &&
          /^\/schools\/[^/]+\/billing(\/|$)/.test(req.path)
        ) {
          req.prisma = scopedPrismaClient(prisma, schoolId) as unknown as PrismaClient;
          req.schoolId = schoolId;
          next();
          return;
        }
        const message =
          access.code === "SCHOOL_SUSPENDED"
            ? "This school's account is suspended. Please contact your school administrator."
            : access.code === "TRIAL_EXPIRED"
              ? "The free trial for this school has ended. Please contact your school administrator."
              : "This school's subscription has expired. Please contact your school administrator to renew.";
        reject(res, 403, access.code, message);
        return;
      }
      const feature = featureForPath(req.path);
      if (feature && !planGateAllows(school.subscriptionStatus, school.plan, req.path)) {
        reject(res, 403, "PLAN_UPGRADE_REQUIRED", planGateMessage(feature));
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
