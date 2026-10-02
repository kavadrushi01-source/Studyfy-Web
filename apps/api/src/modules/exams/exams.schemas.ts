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

// Bulk marks entry (§7 Phase 1 #4): one subject, one section, many
// students — a whole section in one action, never one student at a time.
// Re-entry overwrites (same upsert contract as attendance marking).
export const enterMarksSchema = z.object({
  examSubjectId: z.string().trim().min(1).max(40),
  sectionId: z.string().trim().min(1).max(40),
  records: z
    .array(
      z.object({
        studentId: z.string().trim().min(1).max(40),
        marksObtained: z.number().min(0).max(10000),
        grade: z.string().trim().max(10).optional(),
      }),
    )
    .min(1)
    .max(500),
});

export type EnterMarksInput = z.infer<typeof enterMarksSchema>;

// Saved-marks read (prefill for the entry form): one subject, one section.
// Same class-teacher-or-admin gate as entry — pupils/parents never see
// another pupil's marks through here.
export const savedMarksQuerySchema = z.object({
  examSubjectId: z.string().trim().min(1).max(40),
  sectionId: z.string().trim().min(1).max(40),
});

export type SavedMarksQuery = z.infer<typeof savedMarksQuerySchema>;
