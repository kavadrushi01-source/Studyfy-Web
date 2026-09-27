import { z } from "zod";

const STATUS = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;

// Bulk marking (§10): one section, one day, many students. Day-clean
// YYYY-MM-DD (attendance.date is @db.Date — see the seed file's note on
// why time-carrying values break re-run upserts).
export const markAttendanceSchema = z.object({
  sectionId: z.string().trim().min(1).max(40),
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.")
    .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), {
      message: "Date is not a real calendar date.",
    }),
  records: z
    .array(
      z.object({
        studentId: z.string().trim().min(1).max(40),
        status: z.enum(STATUS),
      }),
    )
    .min(1)
    .max(500),
});

export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

// Daily roster hydration (marking screen reopen): saved statuses for a
// section+day, so reloading a marked day shows what was actually saved
// instead of silent all-PRESENT defaults.
export const rosterSchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.")
    .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()), {
      message: "Date is not a real calendar date.",
    }),
  sectionId: z.string().trim().min(1).max(40),
});

export type RosterInput = z.infer<typeof rosterSchema>;

// Monthly/term summary (§10). month defaults to the current UTC month;
// from/to override it for custom ranges (term reports).
export const summarySchema = z.object({
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM.")
    .optional(),
  from: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "From must be YYYY-MM-DD.")
    .optional(),
  to: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "To must be YYYY-MM-DD.")
    .optional(),
  sectionId: z.string().trim().max(40).optional(),
  studentId: z.string().trim().max(40).optional(),
});

export type SummaryInput = z.infer<typeof summarySchema>;
