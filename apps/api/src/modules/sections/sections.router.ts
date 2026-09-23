import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { invalidateTeacherBoards } from "../metrics/metrics.service.js";

export const sectionsRouter = Router();

const assignSchema = z.object({
  // Teacher identified by school email (no ID hunting in the UI).
  // null clears the assignment.
  teacherEmail: z.string().trim().email().max(160).nullable(),
});

function sendSectionError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// Class/section roster with current assignments (setup + attendance flows).
sectionsRouter.get(
  "/schools/:schoolId/sections",
  authMiddleware,
  tenantMiddleware,
  requirePermission("sections.read"),
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
    const sections = await req.prisma.section.findMany({
      select: {
        id: true,
        name: true,
        class: { select: { id: true, name: true } },
        classTeacher: { select: { id: true, user: { select: { name: true, email: true } } } },
      },
      orderBy: [{ class: { name: "asc" } }, { name: "asc" }],
      take: 200,
    });
    res.json({ success: true, data: { sections }, error: null, meta: null });
  }),
);

// Assign (or clear) a section's class teacher — School Admin only. This is
// the lightweight authorization attendance marking checks (§9.1 note):
// "which teacher may mark this section", separate from the full
// period-by-period Timetable (Chunk 3).
sectionsRouter.patch(
  "/schools/:schoolId/sections/:sectionId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("sections.write"),
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
    const parsed = assignSchema.safeParse(req.body);
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
      const section = await req.prisma.section.findFirst({ where: { id: req.params.sectionId } });
      if (!section) {
        throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
      }
      if (parsed.data.teacherEmail === null) {
        const cleared = await req.prisma.section.update({
          where: { id: section.id },
          data: { classTeacherId: null },
          select: { id: true, classTeacherId: true },
        });
        // Assignment changed → teachers' class lists are stale (§12.3).
        invalidateTeacherBoards(req.schoolId ?? "");
        res.json({ success: true, data: { section: cleared }, error: null, meta: null });
        return;
      }
      const teacherUser = await req.prisma.user.findFirst({
        where: { email: parsed.data.teacherEmail },
        include: { role: true, staffProfile: true },
      });
      if (!teacherUser || !teacherUser.staffProfile || teacherUser.role.name !== "TEACHER") {
        throw new AuthError(404, "TEACHER_NOT_FOUND", "No teacher with that email in this school.");
      }
      const updated = await req.prisma.section.update({
        where: { id: section.id },
        data: { classTeacherId: teacherUser.staffProfile.id },
        select: {
          id: true,
          classTeacher: { select: { id: true, user: { select: { name: true, email: true } } } },
        },
      });
      invalidateTeacherBoards(req.schoolId ?? "");
      res.json({ success: true, data: { section: updated }, error: null, meta: null });
    } catch (err) {
      sendSectionError(res, err);
    }
  }),
);
