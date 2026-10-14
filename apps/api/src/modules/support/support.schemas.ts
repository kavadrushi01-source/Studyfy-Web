import { z } from "zod";

export const ticketStatusSchema = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
export const ticketPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export type TicketStatusInput = z.infer<typeof ticketStatusSchema>;

export const createTicketSchema = z.object({
  subject: z.string().trim().min(4).max(120),
  priority: ticketPrioritySchema.default("MEDIUM"),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

// School-side replies: body only. isInternal/status are owner-only fields —
// sent by a school they are rejected (400), never silently ignored.
export const schoolMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
  })
  .strict();

export type SchoolMessageInput = z.infer<typeof schoolMessageSchema>;

export const ownerMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  isInternal: z.boolean().default(false),
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
});

export type OwnerMessageInput = z.infer<typeof ownerMessageSchema>;

export const listTicketsSchema = z.object({
  status: ticketStatusSchema.optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListTicketsInput = z.infer<typeof listTicketsSchema>;

// Owner queue filters (§7 #27): status + priority + school. Deliberately a
// SEPARATE schema from the school list — schoolId/schoolSlug must never be
// settable on the school route (its school comes from the tenant URL), so
// they live only here. schoolSlug is the human filter (stable, unique;
// the UI types it, no roster dependency, works past any take cap);
export const ownerListTicketsSchema = z.object({
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  schoolId: z.string().trim().min(1).max(64).optional(),
  schoolSlug: z.string().trim().min(1).max(120).optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

export type OwnerListTicketsInput = z.infer<typeof ownerListTicketsSchema>;
