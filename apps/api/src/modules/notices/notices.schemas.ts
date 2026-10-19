import { z } from "zod";

// Base shape, kept standalone so the edit schema can derive a .partial()
// version of it (a ZodEffects has no .partial()/.innerType()).
const noticeFields = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(10).max(5000),
  target: z.enum(["SCHOOL", "CLASS", "SECTION"]).default("SCHOOL"),
  classId: z.string().trim().max(40).optional(),
  sectionId: z.string().trim().max(40).optional(),
});

export const createNoticeSchema = noticeFields
  .refine((v) => (v.target === "CLASS" ? !!v.classId : true), {
    message: "classId is required for class-wide notices.",
  })
  .refine((v) => (v.target === "SECTION" ? !!v.sectionId : true), {
    message: "sectionId is required for section notices.",
  });

export type CreateNoticeInput = z.infer<typeof createNoticeSchema>;

// Edit: every field optional so correcting a typo in the title does not
// require resending the whole notice, but a request that changes nothing is
// rejected rather than silently rewriting the row.
export const updateNoticeSchema = noticeFields.partial().refine(
  (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined),
  { message: "Provide at least one field to update." },
);

export type UpdateNoticeInput = z.infer<typeof updateNoticeSchema>;
