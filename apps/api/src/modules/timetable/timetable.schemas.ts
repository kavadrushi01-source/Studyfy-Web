import { z } from "zod";

// Generation request (§10): explicit per-section subject demand. `days`
// default to Mon–Fri, `periodsPerDay` to 6. Total lessons are capped —
// coloring is polynomial, but a 10k-lesson typo should 400, not churn.
export const generateTimetableSchema = z.object({
  demands: z
    .array(
      z.object({
        sectionId: z.string().trim().min(1).max(40),
        subjectId: z.string().trim().min(1).max(40),
        periodsPerWeek: z.number().int().min(1).max(40),
      }),
    )
    .min(1)
    .max(200),
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]),
  periodsPerDay: z.number().int().min(1).max(10).default(6),
});

export type GenerateTimetableInput = z.infer<typeof generateTimetableSchema>;

// Board read: exactly ONE lens — a section board (what students/parents
// see) or a teacher board ("my timetable"). Scoping enforced in service.
export const boardQuerySchema = z
  .object({
    sectionId: z.string().trim().max(40).optional(),
    teacherId: z.string().trim().max(40).optional(),
  })
  .refine((v) => [v.sectionId, v.teacherId].filter((x) => x !== undefined).length === 1, {
    message: "Provide exactly one of sectionId or teacherId.",
  });

export type BoardQueryInput = z.infer<typeof boardQuerySchema>;

// Manual slot edit: the post-generation adjustment. Same invariants as the
// generator (no double-booked section or teacher), PLUS the qualification
// check the generator gets for free — a manual exception goes through the
// qualifications endpoint first, keeping one source of truth.
export const addSlotSchema = z.object({
  sectionId: z.string().trim().min(1).max(40),
  subjectId: z.string().trim().min(1).max(40),
  teacherId: z.string().trim().min(1).max(40),
  dayOfWeek: z.number().int().min(1).max(7),
  period: z.number().int().min(1).max(20),
});

export type AddSlotInput = z.infer<typeof addSlotSchema>;
