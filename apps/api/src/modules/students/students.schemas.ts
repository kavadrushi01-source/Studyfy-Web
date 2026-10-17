import { z } from "zod";
import { isRealCalendarDate } from "../../lib/school-time.js";

const guardianSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  relationship: z.string().trim().min(2).max(40).default("Guardian"),
});

export const admitStudentSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(160),
    sectionId: z.string().trim().min(1).max(40),
    admissionNo: z.string().trim().max(40).optional(),
    rollNumber: z.number().int().positive().optional(),
    dob: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD.")
      .refine((s) => isRealCalendarDate(s), {
        message: "Date of birth is not a real calendar date.",
      })
      .optional(),
    gender: z.string().trim().max(20).optional(),
    guardians: z.array(guardianSchema).max(3).optional(),
  })
  // A guardian is a separate login with a separate user row: the student's
  // own email cannot also be linked as their guardian.
  .refine((v) => !(v.guardians ?? []).some((g) => g.email.toLowerCase() === v.email.toLowerCase()), {
    message: "A guardian must use a different email address from the student.",
  });

export type AdmitStudentInput = z.infer<typeof admitStudentSchema>;

const SORT_FIELDS = ["name", "email", "admissionNo", "createdAt"] as const;

// Server-driven table controls (§8.5): everything the DataTable claims
// (sort/page/filter) is enforced here, in SQL — never client-side over a
// full dump. Offset pagination (not cursor): honest at MVP scale of a few
// thousand rows per school; revisit if a school outgrows it.
export const listStudentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.enum(SORT_FIELDS).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
  search: z.string().trim().max(80).optional(),
  sectionId: z.string().trim().max(40).optional(),
});

export type ListStudentsInput = z.infer<typeof listStudentsSchema>;
