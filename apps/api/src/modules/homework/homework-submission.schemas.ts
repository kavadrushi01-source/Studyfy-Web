import { z } from "zod";

// Submission body (multipart): text, file, or both — at least one is
// required. File rules mirror admission documents (§13.5): same MIME
// whitelist, same 5 MB cap, same schools/{schoolId}/ folder.
export const submitHomeworkSchema = z.object({
  content: z.string().trim().max(10000).optional(),
});

export type SubmitHomeworkInput = z.infer<typeof submitHomeworkSchema>;
