import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { issueCertificateSchema, listCertificatesSchema } from "./certificates.schemas.js";
import { certificatePdf, issueCertificate, listCertificates } from "./certificates.service.js";

export const certificatesRouter = Router();

function sendCertificatesError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// Issue (office only — certificates.manage): validates the pupil, freezes
// a payload snapshot, assigns the next serial, stores the record. The UI
// opens the pdf URL from the response in a new tab (same print path as
// fee receipts: the browser's own print dialog).
certificatesRouter.post(
  "/schools/:schoolId/certificates",
  authMiddleware,
  tenantMiddleware,
  requirePermission("certificates.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const parsed = issueCertificateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      const result = await issueCertificate(req.prisma, req.user.userId, parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendCertificatesError(res, err);
    }
  }),
);

// Issued log (office only — certificates.read): newest first.
certificatesRouter.get(
  "/schools/:schoolId/certificates",
  authMiddleware,
  tenantMiddleware,
  requirePermission("certificates.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const parsed = listCertificatesSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid query." },
        meta: null,
      });
      return;
    }
    try {
      const result = await listCertificates(req.prisma, parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendCertificatesError(res, err);
    }
  }),
);

// Re-download (office only): regenerated from the frozen snapshot, so it
// prints exactly what was issued even years later.
certificatesRouter.get(
  "/schools/:schoolId/certificates/:certificateId/pdf",
  authMiddleware,
  tenantMiddleware,
  requirePermission("certificates.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    try {
      const { pdf, serial } = await certificatePdf(req.prisma, req.params.certificateId ?? "");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="certificate-${serial.replaceAll("/", "-")}.pdf"`);
      res.setHeader("Content-Length", String(pdf.length));
      res.send(pdf);
    } catch (err) {
      sendCertificatesError(res, err);
    }
  }),
);
