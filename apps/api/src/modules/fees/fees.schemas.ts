import { z } from "zod";

const CATEGORIES = ["TUITION", "TRANSPORT", "LAB", "EXAM", "ACTIVITY", "OTHER"] as const;

// Fee structure per class (§7 Phase 1 #3). Amount is a positive number with
// at most 2 decimals — validated as a STRING first (JSON floats like
// 14500.5 vs 14500.50 lose intent; the string keeps paise exact), then
// stored into Decimal(10,2). Never do arithmetic on the raw JSON number
// (§13.6: Decimal arrives as string over JSON — coerce with Number first).
export const createStructureSchema = z.object({
  classId: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(120),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Amount must be a positive number with at most 2 decimals.")
    .refine((s) => Number(s) > 0, { message: "Amount must be greater than zero." }),
  term: z.string().trim().max(40).optional(),
  category: z.enum(CATEGORIES).default("TUITION"),
  academicYearId: z.string().trim().max(40).optional(),
  description: z.string().trim().max(500).optional(),
});

export type CreateStructureInput = z.infer<typeof createStructureSchema>;
