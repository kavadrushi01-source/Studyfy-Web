import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import { dayBoundsUtc, parseAuditCursor, encodeAuditCursor, type ListPlatformAuditQuery } from "./audit.schemas.js";

// Shared reader for BOTH audit routes (school + platform, §13.10). One
// implementation so the two surfaces can never disagree on ordering,
// cursor shape, or filter semantics. Callers supply the client: the
// tenant-scoped one pins the school AND hides NULL platform rows by
// construction; the platform route passes the raw client with an optional
// schoolId filter. Ordinary reads write nothing.
export async function listAuditLogs(db: PrismaClient, query: ListPlatformAuditQuery) {
  const { take, cursor, entity, action, actorId, from, to, schoolId } = query;

  let keyset: Record<string, unknown> = {};
  if (cursor) {
    const parsed = parseAuditCursor(cursor);
    if (!parsed) {
      throw new AuthError(400, "VALIDATION_ERROR", "Invalid cursor. Drop it to start from the newest entries.");
    }
    keyset = {
      OR: [{ createdAt: { lt: parsed.createdAt } }, { createdAt: parsed.createdAt, id: { lt: parsed.id } }],
    };
  }

  let createdAt: Record<string, unknown> = {};
  if (from) {
    createdAt = { ...createdAt, gte: dayBoundsUtc(from).gte };
  }
  if (to) {
    createdAt = { ...createdAt, lt: dayBoundsUtc(to).lt };
  }

  const rows = await db.auditLog.findMany({
    where: {
      ...keyset,
      ...(schoolId ? { schoolId } : {}),
      ...(entity ? { entity } : {}),
      ...(action ? { action } : {}),
      ...(actorId ? { actorId } : {}),
      ...(from || to ? { createdAt } : {}),
    },
    select: {
      id: true,
      schoolId: true,
      actorId: true,
      impersonatedBy: true,
      action: true,
      entity: true,
      entityId: true,
      before: true,
      after: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });

  // take+1 probing: when an extra row exists, the cursor encodes the last
  // RETURNED row (rows[take-1]) — never the popped extra. Encoding the
  // extra would skip a row on the next page (the extra IS the next page's
  // first row, and the keyset is strictly-older-than).
  let nextCursor: string | null = null;
  if (rows.length > take) {
    const last = rows[take - 1];
    if (last) {
      nextCursor = encodeAuditCursor(last.createdAt, last.id);
    }
    rows.length = take;
  }
  return { logs: rows, nextCursor };
}
