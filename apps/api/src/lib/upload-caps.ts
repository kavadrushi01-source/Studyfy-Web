import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../modules/auth/auth.service.js";

// Demo upload caps (§13.11): the free file-storage quota burns fast when
// anyone on the internet can upload, so demo schools get a smaller
// per-file ceiling (2 MB vs 5 MB) and a per-school stored-file cap (50
// documents, ticket screenshots, and homework submission files combined).
// Real schools keep the §13.5 limits. Checked BEFORE bytes reach storage —
// quota spent on refused uploads would defeat the point.
export const DEMO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const DEMO_UPLOAD_MAX_FILES = 50;

export async function assertDemoUploadAllowed(db: PrismaClient, schoolId: string, sizeBytes: number): Promise<void> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { isDemo: true } });
  if (!school?.isDemo) {
    return;
  }
  if (sizeBytes > DEMO_UPLOAD_MAX_BYTES) {
    throw new AuthError(413, "FILE_TOO_LARGE", "Demo schools are limited to 2 MB per file.");
  }
  const [documents, attachments, homeworkFiles] = await Promise.all([
    db.document.count({ where: { schoolId } }),
    db.ticketAttachment.count({ where: { schoolId } }),
    db.homeworkSubmission.count({ where: { schoolId, fileUrl: { not: null } } }),
  ]);
  if (documents + attachments + homeworkFiles >= DEMO_UPLOAD_MAX_FILES) {
    throw new AuthError(403, "DEMO_UPLOAD_CAP", "Demo schools are limited to 50 stored files.");
  }
}
