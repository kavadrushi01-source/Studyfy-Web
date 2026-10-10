import { z } from "zod";

// Audit reads are newest-first, take-capped (max 100) — same convention as
// the notices board. No cursor pagination: logs are an oversight trail, not
// a dataset to page through exhaustively. Ordinary reads are never logged
// (§13.10), so listing here writes nothing.
export const listAuditSchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(50),
  entity: z.string().min(1).max(64).optional(),
  action: z.string().min(1).max(64).optional(),
});

// Platform-only extra: filter to one school. The school's own readers can
// never pass this — their route carries no such filter and the tenant
// extension pins their school anyway.
export const listPlatformAuditSchema = listAuditSchema.extend({
  schoolId: z.string().min(1).max(64).optional(),
});

export type ListAuditQuery = z.infer<typeof listAuditSchema>;
export type ListPlatformAuditQuery = z.infer<typeof listPlatformAuditSchema>;
