import { z } from "zod";

export const listBooksSchema = z.object({
  search: z.string().trim().min(1).max(60).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  available: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListBooksInput = z.infer<typeof listBooksSchema>;

export const createBookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(120),
  isbn: z.string().trim().min(1).max(30).optional(),
  category: z.string().trim().min(1).max(40).default("General"),
  totalCopies: z.number().int().min(1).max(1000),
});

export type CreateBookInput = z.infer<typeof createBookSchema>;

export const updateBookSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    author: z.string().trim().min(1).max(120).optional(),
    isbn: z.string().trim().min(1).max(30).nullable().optional(),
    category: z.string().trim().min(1).max(40).optional(),
    totalCopies: z.number().int().min(1).max(1000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Provide at least one field to update.",
  });

export type UpdateBookInput = z.infer<typeof updateBookSchema>;

export const issueBookSchema = z.object({
  studentId: z.string().trim().min(1).max(40),
  // Loan length in days; 0 would already be overdue, so the floor is 1.
  dueDays: z.number().int().min(1).max(180).default(14),
});

export type IssueBookInput = z.infer<typeof issueBookSchema>;

export const listLoansSchema = z.object({
  status: z.enum(["ISSUED", "RETURNED", "OVERDUE"]).optional(),
  studentId: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListLoansInput = z.infer<typeof listLoansSchema>;
