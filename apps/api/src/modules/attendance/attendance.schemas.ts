import { z } from "zod";
import { isRealCalendarDate } from "../../lib/school-time.js";

const STATUS = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;

// Bulk marking (§10): one section, one day, many students. Day-clean
// YYYY-MM-DD (attendance.date is @db.Date — see the seed file's note on
// why time-carrying values break re-run upserts).
export const markAttendanceSchema = z
  .object({
    sectionId: z.string().trim().min(1).max(40),
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.")
      .refine((s) => isRealCalendarDate(s), {
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
  })
  // One row per pupil per day: duplicates would inflate the marked count
  // and write duplicate audit rows for the same upsert.
  .refine((v) => new Set(v.records.map((r) => r.studentId)).size === v.records.length, {
    message: "Each student may appear only once per attendance submission.",
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
    .refine((s) => isRealCalendarDate(s), {
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
    .refine((s) => isRealCalendarDate(s), { message: "From is not a real calendar date." })
    .optional(),
  to: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "To must be YYYY-MM-DD.")
    .refine((s) => isRealCalendarDate(s), { message: "To is not a real calendar date." })
    .optional(),
  sectionId: z.string().trim().max(40).optional(),
  studentId: z.string().trim().max(40).optional(),
});

export type SummaryInput = z.infer<typeof summarySchema>;

// Anomaly scan (§7 Phase 3 #18): one section's trailing marked days.
// windowDays bounds the scan (and the Groq summary's input) — a whole
// school in one call would be unbounded work and an unbounded prompt.
export const anomaliesQuerySchema = z.object({
  sectionId: z.string().trim().min(1).max(40),
  windowDays: z.coerce.number().int().min(5).max(30).default(10),
});

export type AnomaliesInput = z.infer<typeof anomaliesQuerySchema>;
