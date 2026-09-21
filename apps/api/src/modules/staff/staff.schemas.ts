import { z } from "zod";

export const assignSubjectSchema = z.object({
  subjectId: z.string().trim().min(1).max(40),
});

export type AssignSubjectInput = z.infer<typeof assignSubjectSchema>;
