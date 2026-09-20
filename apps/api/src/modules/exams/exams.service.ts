import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import type { CreateExamInput } from "./exams.schemas.js";

// Exam + subject links in one transaction (§7 Phase 1 #4). Every lookup
// runs on the tenant-SCOPED client: foreign academic years or subjects
// 404 instead of linking another tenant's curriculum into this exam.
export async function createExam(db: PrismaClient, input: CreateExamInput) {
  if (input.academicYearId) {
    const year = await db.academicYear.findFirst({ where: { id: input.academicYearId } });
    if (!year) {
      throw new AuthError(404, "ACADEMIC_YEAR_NOT_FOUND", "Academic year not found in this school.");
    }
  }
  const subjects = await db.subject.findMany({
    where: { id: { in: input.subjects.map((s) => s.subjectId) } },
    select: { id: true, schoolId: true },
  });
  if (subjects.length !== input.subjects.length) {
    throw new AuthError(404, "SUBJECT_NOT_FOUND", "One or more subjects were not found in this school.");
  }
  const schoolId = subjects[0]?.schoolId;
  if (!schoolId) {
    throw new AuthError(404, "SUBJECT_NOT_FOUND", "One or more subjects were not found in this school.");
  }
  return db.exam.create({
    data: {
      schoolId,
      academicYearId: input.academicYearId,
      name: input.name,
      startDate: input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : undefined,
      endDate: input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : undefined,
      examSubjects: {
        create: input.subjects.map((s) => ({
          schoolId,
          subjectId: s.subjectId,
          maxMarks: s.maxMarks,
          examDate: s.examDate ? new Date(`${s.examDate}T00:00:00Z`) : undefined,
        })),
      },
    },
    include: { examSubjects: { include: { subject: { select: { name: true } } } } },
  });
}
