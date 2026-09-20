import { z } from "zod";

const dayString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.")
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), {
    message: "Date is not a real calendar date.",
  });

// Exam creation (§7 Phase 1 #4): name + date range + subject links in ONE
// action — an exam without subjects is a shell nobody can enter marks
// against, so links are required, not a follow-up call.
export const createExamSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    academicYearId: z.string().trim().max(40).optional(),
    startDate: dayString.optional(),
    endDate: dayString.optional(),
    subjects: z
      .array(
        z.object({
          subjectId: z.string().trim().min(1).max(40),
          maxMarks: z.number().positive().max(10000).default(100),
          examDate: dayString.optional(),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine((v) => !(v.startDate && v.endDate && v.startDate > v.endDate), {
    message: "Start date must not be after end date.",
  })
  .refine((v) => new Set(v.subjects.map((s) => s.subjectId)).size === v.subjects.length, {
    message: "Each subject may appear only once per exam.",
  });

export type CreateExamInput = z.infer<typeof createExamSchema>;
