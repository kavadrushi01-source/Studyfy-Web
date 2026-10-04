import { z } from "zod";

// Decimal-exact rupees (§13.6): strings in, Decimal in DB, strings out.
const rupees = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Amount must be a positive number with at most 2 decimals.")
  .refine((s) => Number(s) <= 10000000, { message: "Amount is unrealistically large." });

const month = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM.");

export const setSalarySchema = z.object({
  staffId: z.string().trim().min(1).max(40),
  monthlyAmount: rupees,
});

export type SetSalaryInput = z.infer<typeof setSalarySchema>;

export const generateMonthSchema = z.object({
  month,
});

export type GenerateMonthInput = z.infer<typeof generateMonthSchema>;

export const listPayrollSchema = z.object({
  month: month.optional(),
  status: z.enum(["PENDING", "PAID"]).optional(),
  staffId: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListPayrollInput = z.infer<typeof listPayrollSchema>;
