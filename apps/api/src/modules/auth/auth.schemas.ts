import { z } from "zod";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const registerSchema = z.object({
  schoolName: z.string().trim().min(2).max(120),
  schoolType: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  // Auto-derived from schoolName when omitted; always collision-checked.
  slug: z.string().trim().regex(slugPattern, "lowercase letters, numbers and hyphens only").max(80).optional(),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().email().max(160),
  adminPassword: z.string().min(8).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(128),
  // OPTIONAL slug: omitted means Platform Owner login (spec §8.3).
  schoolSlug: z.string().trim().max(80).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(160),
  // Same slug semantics as login: omitted means the Platform Owner path.
  schoolSlug: z.string().trim().max(80).optional(),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(16).max(256),
  newPassword: z.string().min(8).max(128),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
