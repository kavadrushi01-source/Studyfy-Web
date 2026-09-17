import { z } from "zod";

export const createNoticeSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    body: z.string().trim().min(10).max(5000),
    target: z.enum(["SCHOOL", "CLASS", "SECTION"]).default("SCHOOL"),
    classId: z.string().trim().max(40).optional(),
    sectionId: z.string().trim().max(40).optional(),
  })
  .refine((v) => (v.target === "CLASS" ? !!v.classId : true), {
    message: "classId is required for class-wide notices.",
  })
  .refine((v) => (v.target === "SECTION" ? !!v.sectionId : true), {
    message: "sectionId is required for section notices.",
  });

export type CreateNoticeInput = z.infer<typeof createNoticeSchema>;
