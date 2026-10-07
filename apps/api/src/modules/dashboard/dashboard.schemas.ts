import { z } from "zod";

// Parent board child selector: ?with=<studentId>. Omitted = first linked
// child. Anything else must be one of the caller's linked children
// (enforced in the service, never widened).
export const parentBoardQuerySchema = z.object({
  with: z.string().min(1).max(64).optional(),
});

// Analytics windows (§7 Phase 3 #19): bounded ranges, never open-ended —
// an unbounded trend is unbounded work. Defaults match the page's first
// paint (30 days, 6 months).
export const analyticsQuerySchema = z.object({
  attendanceDays: z.coerce.number().int().min(7).max(90).default(30),
  feeMonths: z.coerce.number().int().min(3).max(12).default(6),
});
