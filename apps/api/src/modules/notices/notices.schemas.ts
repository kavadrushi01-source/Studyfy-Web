import { z } from "zod";

const targetEnum = z.enum(["SCHOOL", "CLASS", "SECTION"]);

// Edit shape: NO `.default()` on target. The create schema defaults it to
// SCHOOL, but reusing that shape for the edit made every parse of `{}` come
// back as `{ target: "SCHOOL" }`, so the "at least one field" guard below
// always passed. A silent `PATCH {}` then re-ran the retarget logic and
// turned a class-scoped notice into a school-wide one with no edit at all.
// The update shape must therefore stay default-free.
const noticeFields = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(10).max(5000),
  target: targetEnum,
  classId: z.string().trim().max(40).optional(),
  sectionId: z.string().trim().max(40).optional(),
});

export const createNoticeSchema = noticeFields
  .extend({ target: targetEnum.default("SCHOOL") })
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
