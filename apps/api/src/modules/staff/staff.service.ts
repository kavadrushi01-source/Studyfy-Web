import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";

// Teacher qualification assignment (§9.1 teacher_subjects): which subjects
// a teacher may be scheduled to teach. Only TEACHER-role staff qualify —
// assigning a subject to an accountant is a 404 (no such teacher here),
// not a silent row. Scoped lookups make foreign staff/subject ids 404.
export async function assignSubject(db: PrismaClient, staffId: string, subjectId: string) {
  const staff = await db.staff.findFirst({
    where: { id: staffId },
    include: { user: { select: { role: true } } },
  });
  if (!staff || staff.user.role.name !== "TEACHER") {
    throw new AuthError(404, "TEACHER_NOT_FOUND", "No teacher with that id in this school.");
  }
  const subject = await db.subject.findFirst({ where: { id: subjectId } });
  if (!subject) {
    throw new AuthError(404, "SUBJECT_NOT_FOUND", "Subject not found in this school.");
  }
  const existing = await db.teacherSubject.findUnique({
    where: { staffId_subjectId: { staffId: staff.id, subjectId: subject.id } },
  });
  if (existing) {
    throw new AuthError(409, "ALREADY_ASSIGNED", "This teacher is already qualified for the subject.");
  }
  return db.teacherSubject.create({
    data: { schoolId: staff.schoolId, staffId: staff.id, subjectId: subject.id },
    include: { subject: { select: { name: true } } },
  });
}

export async function unassignSubject(db: PrismaClient, staffId: string, subjectId: string): Promise<void> {
  const row = await db.teacherSubject.findFirst({
    where: { staffId, subjectId },
  });
  if (!row) {
    throw new AuthError(404, "ASSIGNMENT_NOT_FOUND", "That qualification is not assigned.");
  }
  await db.teacherSubject.delete({ where: { id: row.id } });
}
