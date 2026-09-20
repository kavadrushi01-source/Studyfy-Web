import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import type { CreateExamInput, EnterMarksInput } from "./exams.schemas.js";

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

interface MarksCaller {
  userId: string;
  role: string;
}

// Bulk marks entry (§7 Phase 1 #4): authorized by the SAME relationship as
// attendance — the section's class teacher, or a School Admin.
// classTeacherId is the interim check here too: the fuller per-subject
// teacher assignment arrives with Timetable (Chunk 3), and this gate can
// be tightened to it then without changing the route shape.
export async function enterMarks(
  db: PrismaClient,
  examId: string,
  caller: MarksCaller,
  input: EnterMarksInput,
): Promise<{ entered: number }> {
  const exam = await db.exam.findFirst({ where: { id: examId } });
  if (!exam) {
    throw new AuthError(404, "EXAM_NOT_FOUND", "Exam not found in this school.");
  }
  const examSubject = await db.examSubject.findFirst({
    where: { id: input.examSubjectId, examId: exam.id },
  });
  if (!examSubject) {
    throw new AuthError(404, "EXAM_SUBJECT_NOT_FOUND", "Subject is not part of this exam.");
  }
  const section = await db.section.findFirst({ where: { id: input.sectionId } });
  if (!section) {
    throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
  }

  if (caller.role !== "SCHOOL_ADMIN") {
    const staff = await db.staff.findFirst({ where: { userId: caller.userId } });
    if (!staff || section.classTeacherId !== staff.id) {
      throw new AuthError(
        403,
        "NOT_SECTION_TEACHER",
        "Only the section's class teacher or a School Admin may enter its marks.",
      );
    }
  }

  const maxMarks = Number(examSubject.maxMarks);
  for (const record of input.records) {
    if (record.marksObtained > maxMarks) {
      throw new AuthError(
        400,
        "MARKS_EXCEED_MAXIMUM",
        `Marks cannot exceed the maximum of ${maxMarks} for this subject.`,
      );
    }
  }
  const studentIds = input.records.map((r) => r.studentId);
  const members = await db.student.findMany({
    where: { id: { in: studentIds }, sectionId: section.id },
    select: { id: true },
  });
  const memberIds = new Set(members.map((m) => m.id));
  if (studentIds.some((id) => !memberIds.has(id))) {
    throw new AuthError(400, "STUDENT_NOT_IN_SECTION", "Every graded student must belong to the section.");
  }

  await db.$transaction(
    input.records.map((record) =>
      db.mark.upsert({
        where: { examSubjectId_studentId: { examSubjectId: examSubject.id, studentId: record.studentId } },
        update: { marksObtained: record.marksObtained, grade: record.grade },
        create: {
          schoolId: section.schoolId,
          examSubjectId: examSubject.id,
          studentId: record.studentId,
          marksObtained: record.marksObtained,
          grade: record.grade,
        },
      }),
    ),
  );
  return { entered: input.records.length };
}
