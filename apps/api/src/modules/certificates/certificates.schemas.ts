import { z } from "zod";
import { CERTIFICATE_TYPES } from "../../lib/certificates.js";

export const issueCertificateSchema = z.object({
  studentId: z.string().trim().min(1).max(40),
  type: z.enum(CERTIFICATE_TYPES),
});

export type IssueCertificateInput = z.infer<typeof issueCertificateSchema>;

export const listCertificatesSchema = z.object({
  studentId: z.string().trim().min(1).max(40).optional(),
  type: z.enum(CERTIFICATE_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListCertificatesInput = z.infer<typeof listCertificatesSchema>;
