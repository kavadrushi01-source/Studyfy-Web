import { z } from "zod";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayField = (name: string) =>
  z
    .string()
    .trim()
    .regex(DAY, `${name} must be YYYY-MM-DD.`)
    .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), { message: `${name} is not a real calendar date.` });

// Every owner billing action asks for a reason (§7 #23): required, so the
// audit trail always says WHY — a reasonless suspension/reactivation/plan
// change/trial move is a 400, never a silent row.
const ownerReason = z.string().trim().min(1).max(500);

export const billingPlanSchema = z.object({
  plan: z.enum(["BASIC", "STANDARD", "PREMIUM"]),
  reason: ownerReason,
});

export const suspendSchoolSchema = z.object({
  reason: ownerReason,
});

export const reactivateSchoolSchema = z.object({
  plan: z.enum(["BASIC", "STANDARD", "PREMIUM"]),
  periodStart: dayField("Period start"),
  periodEnd: dayField("Period end"),
  reason: ownerReason,
});

export const trialExtensionSchema = z.object({
  trialEndsAt: dayField("Trial end"),
  reason: ownerReason,
});

export const issueSubscriptionInvoiceSchema = z.object({
  schoolId: z.string().trim().min(1).max(64),
  plan: z.enum(["BASIC", "STANDARD", "PREMIUM"]),
  periodStart: dayField("Period start"),
  periodEnd: dayField("Period end"),
});

export const subscriptionInvoiceListSchema = z.object({
  schoolId: z.string().trim().min(1).max(64).optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

// Admin pay-verify (§13.8 fallback shape): reconcile OUR pending order id
// against what Razorpay holds. Order id only — never an amount.
export const payVerifySchema = z.object({
  orderId: z.string().trim().min(1).max(64),
});

export type BillingPlanInput = z.infer<typeof billingPlanSchema>;
export type SuspendSchoolInput = z.infer<typeof suspendSchoolSchema>;
export type ReactivateSchoolInput = z.infer<typeof reactivateSchoolSchema>;
export type TrialExtensionInput = z.infer<typeof trialExtensionSchema>;
export type IssueSubscriptionInvoiceInput = z.infer<typeof issueSubscriptionInvoiceSchema>;
