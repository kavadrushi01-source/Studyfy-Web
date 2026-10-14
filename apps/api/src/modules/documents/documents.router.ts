import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { documentStorage, StorageUnconfiguredError } from "../../lib/storage.js";
import { assertDemoUploadAllowed } from "../../lib/upload-caps.js";
import { AuthError } from "../auth/auth.service.js";

export const documentsRouter = Router();

// §13.5 whitelist: images + PDF only, 5 MB max. Checked here on the
// claimed MIME AND the file extension (both are client-controlled, so both
// must agree — deep content sniffing is noted future hardening, not Phase 1).
const ALLOWED: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};
const MAX_BYTES = 5 * 1024 * 1024;

const DOCUMENT_TYPES = ["PHOTO", "BIRTH_CERTIFICATE", "ADDRESS_PROOF", "REPORT_CARD", "OTHER"] as const;

const uploadBodySchema = z.object({
  ownerId: z.string().trim().min(1).max(40),
  type: z.enum(DOCUMENT_TYPES),
});

const upload = multer({
  storage: multer.memoryStorage(),
  // No multer-level limits: size/MIME are validated below so every
  // rejection returns the envelope (413/415), never an HTML error page.
});

function sendDocumentError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  if (err instanceof StorageUnconfiguredError) {
    res.status(503).json({
      success: false,
      data: null,
      error: { code: "STORAGE_UNCONFIGURED", message: err.message },
      meta: null,
    });
    return;
  }
  throw err;
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

// Admission upload (SIS): ADMIN/ACCOUNTANT only. File lands in Cloudinary
// under schools/{schoolId}/documents with a random public ID (§13.5); the
// DB row is tenant-scoped like everything else (Document ∈ TENANT_MODELS).
documentsRouter.post(
  "/schools/:schoolId/documents",
  authMiddleware,
  tenantMiddleware,
  requirePermission("documents.write"),
  upload.single("file"),
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
    const parsed = uploadBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: "Attach the document as multipart field 'file'." },
        meta: null,
      });
      return;
    }
    const extensions = ALLOWED[file.mimetype];
    if (!extensions || !extensions.includes(extOf(file.originalname))) {
      res.status(415).json({
        success: false,
        data: null,
        error: { code: "UNSUPPORTED_FILE_TYPE", message: "Only JPEG, PNG, WebP images and PDF files are accepted." },
        meta: null,
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      res.status(413).json({
        success: false,
        data: null,
        error: { code: "FILE_TOO_LARGE", message: "Files must be 5 MB or smaller." },
        meta: null,
      });
      return;
    }
    // Owner must be a user of THIS school — the scoped lookup 404s on a
    // foreign ownerId instead of linking across tenants.
    const owner = await req.prisma.user.findFirst({ where: { id: parsed.data.ownerId } });
    if (!owner) {
      res.status(404).json({
        success: false,
        data: null,
        error: { code: "OWNER_NOT_FOUND", message: "Owner not found in this school." },
        meta: null,
      });
      return;
    }
    try {
      const schoolId = req.schoolId ?? "";
      // Demo quota guard (§13.11): before bytes reach storage.
      await assertDemoUploadAllowed(req.prisma, schoolId, file.size);
      const stored = await documentStorage().upload({
        buffer: file.buffer,
        schoolId,
        mimeType: file.mimetype,
        originalName: file.originalname,
      });
      const document = await req.prisma.document.create({
        data: {
          schoolId,
          ownerId: owner.id,
          url: stored.url,
          type: parsed.data.type,
        },
      });
      res.status(201).json({ success: true, data: { document }, error: null, meta: null });
    } catch (err) {
      sendDocumentError(res, err);
    }
  }),
);

// Read one document. Staff (permission) read any in-school row; STUDENT is
// narrowed to rows they own, PARENT to rows owned by linked children —
// resolved through studentScope (selfscope runs first), never trusted input.
documentsRouter.get(
  "/schools/:schoolId/documents/:documentId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("documents.read"),
  studentSelfScope,
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
    const document = await req.prisma.document.findFirst({
      where: { id: req.params.documentId },
      select: { id: true, ownerId: true, url: true, type: true, createdAt: true },
    });
    if (!document) {
      // findFirst on the scoped client returns null for other schools' rows:
      // cross-tenant reads are indistinguishable from missing (no oracle).
      res.status(404).json({
        success: false,
        data: null,
        error: { code: "NOT_FOUND", message: "Document not found." },
        meta: null,
      });
      return;
    }
    if (req.studentScope) {
      const owned = await req.prisma.student.findMany({
        where: { id: { in: req.studentScope.studentIds } },
        select: { userId: true },
      });
      const allowedOwners = new Set(owned.map((s) => s.userId));
      if (!allowedOwners.has(document.ownerId)) {
        res.status(403).json({
          success: false,
          data: null,
          error: { code: "FORBIDDEN", message: "Not your document." },
          meta: null,
        });
        return;
      }
    }
    res.json({ success: true, data: { document }, error: null, meta: null });
  }),
);
