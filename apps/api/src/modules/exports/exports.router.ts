import { randomUUID } from "node:crypto";
import { ZipArchive } from "archiver";
import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { exportLimiter } from "../../middleware/security.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { buildExportFiles, recordExportAudit, type ExportManifest } from "./exports.service.js";

export const exportsRouter = Router();

function zipFilename(slug: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `studyfy-export-${slug}-${day}.zip`;
}

// POST /schools/:schoolId/exports — a School Admin exports their OWN
// school (§13.10): rate-limited (1/hour/school), always audited, streamed
// as a zip (archiver pipes chunks — the archive is never buffered whole,
// per the 512MB-instance warning). The audit row lands BEFORE streaming
// starts, so even a dropped connection leaves an attempt on the books.
exportsRouter.post(
  "/schools/:schoolId/exports",
  authMiddleware,
  tenantMiddleware,
  requirePermission("exports.manage"),
  exportLimiter(),
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
    const schoolId = req.schoolId ?? "";
    const built = await buildExportFiles(req.prisma, schoolId);
    const exportId = randomUUID();
    const manifest: ExportManifest = {
      school: built.school,
      exportedAt: new Date().toISOString(),
      exportId,
      exporterId: req.user.userId,
      exporterRole: req.user.role,
      reason: null,
      files: [...Object.keys(built.files), "manifest.json"],
      counts: built.counts,
    };
    await recordExportAudit(req.prisma, {
      schoolId,
      exporterId: req.user.userId,
      reason: null,
      exportId,
      fileCount: Object.keys(built.files).length + 1,
    });
    streamZip(res, zipFilename(built.school.slug), built.files, manifest);
  }),
);

export function streamZip(
  res: Response,
  filename: string,
  files: Record<string, string>,
  manifest: ExportManifest,
): void {
  res.status(200);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("error", (err: unknown) => {
    console.error("Export zip streaming failed:", err);
    res.destroy(err instanceof Error ? err : undefined);
  });
  archive.pipe(res);
  for (const [name, content] of Object.entries(files)) {
    archive.append(content, { name });
  }
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  void archive.finalize();
}
