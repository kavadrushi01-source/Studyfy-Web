import { z } from "zod";

export const impersonateSchema = z.object({
  targetUserId: z.string().trim().min(1).max(64),
  // A ticket reference or free text — required, and long enough that "x"
  // cannot pass as a reason (§13.9: reason required, always audited).
  reason: z.string().trim().min(8).max(500),
});

export type ImpersonateInput = z.infer<typeof impersonateSchema>;

export const endImpersonationSchema = z.object({
  sessionId: z.string().trim().min(1).max(64),
});

export type EndImpersonationInput = z.infer<typeof endImpersonationSchema>;
