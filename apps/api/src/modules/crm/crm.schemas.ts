import { z } from "zod";

// Pipeline stages (§7 Phase 2 #16). Stored as plain strings (the column
// predates the pipeline); the API validates every transition here.
export const ENQUIRY_STATUSES = ["NEW", "CONTACTED", "VISITED", "ADMITTED", "REJECTED"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const listEnquiriesSchema = z.object({
  status: z.enum(ENQUIRY_STATUSES).optional(),
  search: z.string().trim().min(1).max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListEnquiriesInput = z.infer<typeof listEnquiriesSchema>;

export const updateEnquirySchema = z
  .object({
    status: z.enum(ENQUIRY_STATUSES).optional(),
    // Nullable: assign to a staffer, or unassign back to the queue.
    assigneeId: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.assigneeId !== undefined, {
    message: "Provide status and/or assigneeId.",
  });

export type UpdateEnquiryInput = z.infer<typeof updateEnquirySchema>;

export const addNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export type AddNoteInput = z.infer<typeof addNoteSchema>;
