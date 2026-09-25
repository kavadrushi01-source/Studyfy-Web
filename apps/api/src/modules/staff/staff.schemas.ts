import { z } from "zod";

export const assignSubjectSchema = z.object({
  subjectId: z.string().trim().min(1).max(40),
});

export type AssignSubjectInput = z.infer<typeof assignSubjectSchema>;

// Staff invite (§7 Phase 1 #1 — a real school must add teachers without
// seed access). Only staff roles: TEACHER or ACCOUNTANT. Never admin
// creation (that path is register) and never STUDENT/PARENT (admission).
export const inviteStaffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  role: z.enum(["TEACHER", "ACCOUNTANT"]),
  designation: z.string().trim().max(80).optional(),
});

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;
