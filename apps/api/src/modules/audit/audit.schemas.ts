import { z } from "zod";

// Audit reads are newest-first with KEYSET cursor pagination
// (createdAt desc, id desc tiebreak) — stable under concurrent writes,
// unlike offset paging which skips or repeats rows as new logs land.
// Cursor is opaque: "<createdAt ISO>|<id>", validated on parse.
// Ordinary reads are never logged (§13.10), so listing here writes nothing.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const listAuditSchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(128).optional(),
  entity: z.string().min(1).max(64).optional(),
  action: z.string().min(1).max(64).optional(),
  actorId: z.string().min(1).max(64).optional(),
  // UTC calendar-day bounds on createdAt (inclusive from, exclusive to).
  from: z.string().regex(DAY, "From date must be YYYY-MM-DD.").optional(),
  to: z.string().regex(DAY, "To date must be YYYY-MM-DD.").optional(),
});

// Platform-only extra: filter to one school. The school's own readers can
// never pass this — their route carries no such filter and the tenant
// extension pins their school anyway.
export const listPlatformAuditSchema = listAuditSchema.extend({
  schoolId: z.string().min(1).max(64).optional(),
});

export type ListAuditQuery = z.infer<typeof listAuditSchema>;
export type ListPlatformAuditQuery = z.infer<typeof listPlatformAuditSchema>;

export interface AuditCursor {
  createdAt: Date;
  id: string;
}

// Fail-closed parse: a tampered cursor is a 400, never a silent full scan.
export function parseAuditCursor(cursor: string): AuditCursor | null {
  const sep = cursor.indexOf("|");
  if (sep < 1) {
    return null;
  }
  const createdAt = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0 || id.length > 64) {
    return null;
  }
  return { createdAt, id };
}

export function encodeAuditCursor(createdAt: Date, id: string): string {
  return `${createdAt.toISOString()}|${id}`;
}

export function dayBoundsUtc(day: string): { gte: Date; lt: Date } {
  const gte = new Date(`${day}T00:00:00Z`);
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}
