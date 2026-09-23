import { z } from "zod";

// Parent board child selector: ?with=<studentId>. Omitted = first linked
// child. Anything else must be one of the caller's linked children
// (enforced in the service, never widened).
export const parentBoardQuerySchema = z.object({
  with: z.string().min(1).max(64).optional(),
});
