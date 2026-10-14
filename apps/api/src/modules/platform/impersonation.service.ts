import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { pickAuditFields, recordAudit } from "../../lib/audit.js";
import { signImpersonationToken } from "../../lib/jwt.js";
import { AuthError } from "../auth/auth.service.js";
import type { EndImpersonationInput, ImpersonateInput } from "./impersonation.schemas.js";

// Staff only (§13.9): a support problem is reproducible from a staff view,
// and Student/Parent accounts are minors' accounts — never impersonable
// (the founder can relax this deliberately; this code never does).
const IMPERSONABLE_ROLES = new Set(["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT"]);

// Single source of truth with lib/jwt (30 minutes) — the test pins it.
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface ImpersonationTarget {
  id: string;
  name: string;
  role: string;
  schoolId: string;
}

export async function startImpersonation(
  db: PrismaClient,
  ownerId: string,
  ip: string,
  input: ImpersonateInput,
): Promise<{ accessToken: string; expiresAt: string; sessionId: string; target: ImpersonationTarget }> {
  const target = await db.user.findFirst({
    where: { id: input.targetUserId },
    select: {
      id: true,
      name: true,
      schoolId: true,
      isActive: true,
      role: { select: { name: true } },
      school: { select: { subscriptionStatus: true } },
    },
  });
  if (!target) {
    throw new AuthError(404, "USER_NOT_FOUND", "User not found.");
  }
  const roleName = target.role.name;
  if (!IMPERSONABLE_ROLES.has(roleName)) {
    throw new AuthError(
      403,
      "IMPERSONATION_TARGET_ROLE",
      "Only School Admin, Teacher, and Accountant accounts can be impersonated.",
    );
  }
  if (!target.isActive) {
    throw new AuthError(403, "IMPERSONATION_TARGET_INACTIVE", "Deactivated accounts cannot be impersonated.");
  }
  // A tenant token without a school scopes nothing — refuse instead of
  // minting a session that sees the void.
  if (!target.schoolId || !target.school) {
    throw new AuthError(403, "IMPERSONATION_TARGET_NO_SCHOOL", "Accounts without a school cannot be impersonated.");
  }
  if (target.school.subscriptionStatus === "SUSPENDED") {
    throw new AuthError(403, "IMPERSONATION_TARGET_SUSPENDED_SCHOOL", "Reactivate the school first — suspended schools cannot be impersonated.");
  }

  const sessionId = randomUUID();
  const endsAt = new Date(Date.now() + SESSION_TTL_MS);
  const accessToken = signImpersonationToken({
    sub: target.id,
    schoolId: target.schoolId,
    role: roleName,
    impersonatedBy: ownerId,
    sessionId,
  });
  await recordAudit(db, {
    schoolId: target.schoolId,
    actorId: ownerId,
    action: "IMPERSONATION_START",
    entity: "Impersonation",
    entityId: sessionId,
    after: pickAuditFields("Impersonation", {
      id: sessionId,
      targetUserId: target.id,
      targetRole: roleName,
      ownerId,
      reason: input.reason,
      ipAddress: ip,
      endsAt: endsAt.toISOString(),
    }),
  });
  return {
    accessToken,
    expiresAt: endsAt.toISOString(),
    sessionId,
    target: { id: target.id, name: target.name, role: roleName, schoolId: target.schoolId },
  };
}

export async function endImpersonation(
  db: PrismaClient,
  ownerId: string,
  input: EndImpersonationInput,
): Promise<{ sessionId: string; endedAt: string }> {
  const start = await db.auditLog.findFirst({
    where: { action: "IMPERSONATION_START", entity: "Impersonation", entityId: input.sessionId },
  });
  if (!start) {
    throw new AuthError(404, "IMPERSONATION_SESSION_NOT_FOUND", "No such impersonation session.");
  }
  if (start.actorId !== ownerId) {
    throw new AuthError(403, "IMPERSONATION_NOT_YOURS", "Only the owner who started the session can end it.");
  }
  const alreadyEnded = await db.auditLog.findFirst({
    where: { action: "IMPERSONATION_END", entity: "Impersonation", entityId: input.sessionId },
  });
  if (alreadyEnded) {
    throw new AuthError(409, "IMPERSONATION_ALREADY_ENDED", "This session already ended.");
  }
  const endedAt = new Date().toISOString();
  await recordAudit(db, {
    schoolId: start.schoolId,
    actorId: ownerId,
    action: "IMPERSONATION_END",
    entity: "Impersonation",
    entityId: input.sessionId,
    after: pickAuditFields("Impersonation", { id: input.sessionId, endedAt }),
  });
  return { sessionId: input.sessionId, endedAt };
}
