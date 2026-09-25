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

// Bulk invoice generation: exactly ONE targeting mode per action — a whole
// class, one section, or an explicit student list. dueDate is required:
// an invoice without a due date can never become overdue, which breaks
// reminders scheduling downstream.
export const generateInvoicesSchema = z
  .object({
    structureId: z.string().trim().min(1).max(40),
    classId: z.string().trim().max(40).optional(),
    sectionId: z.string().trim().max(40).optional(),
    studentIds: z.array(z.string().trim().min(1).max(40)).max(500).optional(),
    dueDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD.")
      .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), {
        message: "Due date is not a real calendar date.",
      }),
  })
  .refine(
    (v) => [v.classId, v.sectionId, v.studentIds].filter((x) => x !== undefined).length === 1,
    { message: "Provide exactly one of classId, sectionId, or studentIds." },
  );

export type GenerateInvoicesInput = z.infer<typeof generateInvoicesSchema>;

// Manual payment recording (cash/offline counter collection). Amount is a
// validated STRING for the same Decimal reasons as structures (§13.6).
// RAZORPAY is deliberately rejected here: online money arrives ONLY via the
// Phase 2 webhook (§13.8) — this endpoint must never be a backdoor that
// marks online invoices paid without gateway proof.
const MANUAL_METHODS = ["CASH", "UPI", "CARD", "BANK_TRANSFER"] as const;

export const recordPaymentSchema = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Amount must be a positive number with at most 2 decimals.")
    .refine((s) => Number(s) > 0, { message: "Amount must be greater than zero." }),
  method: z.enum(MANUAL_METHODS),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

const INVOICE_STATUS = ["PENDING", "PARTIAL", "PAID", "OVERDUE", "REFUNDED"] as const;
const INVOICE_SORT = ["dueDate", "createdAt", "amount"] as const;

// Ledger controls: status/section/student filters + paging. Same honesty
// rule as the roster — everything claimed is enforced in SQL.
export const listInvoicesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(INVOICE_SORT).default("dueDate"),
  order: z.enum(["asc", "desc"]).default("asc"),
  status: z.enum(INVOICE_STATUS).optional(),
  sectionId: z.string().trim().max(40).optional(),
  studentId: z.string().trim().max(40).optional(),
});

export type ListInvoicesInput = z.infer<typeof listInvoicesSchema>;

// Payment history: same paging honesty as the ledger. Every payment links
// its receipt viewer, so this is the "Payments & Receipts" destination.
export const listPaymentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  studentId: z.string().trim().max(40).optional(),
});

export type ListPaymentsInput = z.infer<typeof listPaymentsSchema>;
