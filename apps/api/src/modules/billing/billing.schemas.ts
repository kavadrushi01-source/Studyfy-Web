import { z } from "zod";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayField = (name: string) =>
  z
    .string()
    .trim()
    .regex(DAY, `${name} must be YYYY-MM-DD.`)
    .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), { message: `${name} is not a real calendar date.` });

export const billingPlanSchema = z.object({
  plan: z.enum(["BASIC", "STANDARD", "PREMIUM"]),
});

export const suspendSchoolSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional(),
});

export const reactivateSchoolSchema = z.object({
  plan: z.enum(["BASIC", "STANDARD", "PREMIUM"]),
  periodStart: dayField("Period start"),
  periodEnd: dayField("Period end"),
});

export const trialExtensionSchema = z.object({
  trialEndsAt: dayField("Trial end"),
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

export type BillingPlanInput = z.infer<typeof billingPlanSchema>;
export type SuspendSchoolInput = z.infer<typeof suspendSchoolSchema>;
export type ReactivateSchoolInput = z.infer<typeof reactivateSchoolSchema>;
export type TrialExtensionInput = z.infer<typeof trialExtensionSchema>;
export type IssueSubscriptionInvoiceInput = z.infer<typeof issueSubscriptionInvoiceSchema>;
