import { z } from "zod";

export const sendMessageSchema = z.object({
  receiverId: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1).max(5000),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const threadQuerySchema = z.object({
  with: z.string().trim().min(1).max(40),
});

export type ThreadQueryInput = z.infer<typeof threadQuerySchema>;
