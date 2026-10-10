import type { PrismaClient } from "@prisma/client";

// Audit logs (§13.10) — the ONE writer. Every audited change in the product
// goes through recordAudit(), ideally inside the same database transaction
// as the change, so a change can't commit without its log row or the
// reverse. There is deliberately NO update/delete path: no route, no
// service method, no UI — append-only. (A test asserts no auditLog
// update/delete call exists anywhere in src/.)
//
// Redaction by ALLOWLIST, never blocklist: before/after JSON is built from
// the per-entity field lists below, never by serializing a whole row.
// Password hashes, token hashes, device/API keys and their hashes, webhook
// secrets and payment-instrument data must never appear in a log —
// pickAuditFields() throws on an entity with no allowlist instead of
// logging everything, so a new audited entity fails loudly, not leakily.
const AUDIT_FIELDS: Record<string, readonly string[]> = {
  User: ["id", "role", "isActive"],
  BiometricDevice: ["id", "name", "isActive"],
  School: ["id", "subscriptionStatus", "plan", "isDemo"],
};

export function pickAuditFields(entity: string, row: Record<string, unknown>): AuditSnapshot {
  const allowed = AUDIT_FIELDS[entity];
  if (!allowed) {
    throw new Error(`No audit allowlist for ${entity} — add one; do not log the whole row.`);
  }
  // Every allowlisted field across entities is a scalar (ids, names, status
  // strings, booleans) — the cast below only satisfies Prisma's
  // InputJsonValue; it cannot smuggle a nested object in, because the keys
  // are fixed above and the values come from those keys alone.
  return Object.fromEntries(allowed.filter((k) => k in row).map((k) => [k, row[k]])) as AuditSnapshot;
}

// Snapshots are flat scalar maps — see the cast note in pickAuditFields.
export type AuditSnapshot = Record<string, string | number | boolean | null>;

export interface AuditEvent {
  // NULL means a platform-level action (e.g. an owner login) — the tenant
  // extension hides NULL rows from every school's scoped reads (§9.1).
  schoolId: string | null;
  actorId: string;
  impersonatedBy?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  // Snapshots as plain objects; allowlisted at write time. Callers pass
  // shaped objects (e.g. { id, role, isActive }), never raw DB rows.
  before?: AuditSnapshot | null;
  after?: AuditSnapshot | null;
}

export async function recordAudit(db: PrismaClient, event: AuditEvent): Promise<{ id: string }> {
  // Throws before any write when the entity has no allowlist — a new
  // audited feature that forgot its allowlist breaks its own tests, it
  // never ships a full-row log.
  const before = event.before ? pickAuditFields(event.entity, event.before) : undefined;
  const after = event.after ? pickAuditFields(event.entity, event.after) : undefined;
  const row = await db.auditLog.create({
    data: {
      schoolId: event.schoolId,
      actorId: event.actorId,
      ...(event.impersonatedBy ? { impersonatedBy: event.impersonatedBy } : {}),
      action: event.action,
      entity: event.entity,
      ...(event.entityId ? { entityId: event.entityId } : {}),
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    },
    select: { id: true },
  });
  return row;
}
