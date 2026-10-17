import { z } from "zod";
import { isRealCalendarDate } from "../../lib/school-time.js";

// Homework posting (§7 Phase 1 #6): title + body + due day. Day-clean
// YYYY-MM-DD like every other school-day boundary in this codebase.
export const postHomeworkSchema = z.object({
  sectionId: z.string().trim().min(1).max(40),
  subjectId: z.string().trim().min(1).max(40),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(5000),
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD.")
    .refine((s) => isRealCalendarDate(s), {
      message: "Due date is not a real calendar date.",
    }),
});

export type PostHomeworkInput = z.infer<typeof postHomeworkSchema>;
