import type { PrismaClient } from "@prisma/client";
import { gradeLetter, percentOf, rankAll, topK } from "../../lib/grades.js";
import type { ReportCardData } from "../../lib/report-card.js";
import { AuthError } from "../auth/auth.service.js";
import { attendanceSummary } from "../attendance/attendance.service.js";
import { invalidateActivityFeed, invalidateStudentBoards, invalidateTeacherBoards } from "../metrics/metrics.service.js";
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
  const exam = await db.exam.create({
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
  // New exam → the activities feed and teachers' upcoming lists are stale.
  invalidateActivityFeed(schoolId);
  invalidateTeacherBoards(schoolId);
  return exam;
}

interface MarksCaller {
  userId: string;
  role: string;
}// Bulk marks entry (§7 Phase 1 #4): authorized by the SAME relationship as
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
  // New scores → graded students' boards are stale (§12.3).
  invalidateStudentBoards(section.schoolId);
  return { entered: input.records.length };
}

export interface RankedResult {
  studentId: string;
  name: string;
  total: number;
  max: number;
  percent: number;
  grade: string;
  rank: number;
}

// Ranked results (spec §10): per-student totals across the exam's subjects,
// rounded percent + grade letter, competition ranks. `topK` slices the
// board through the heap WITHOUT a full sort — but ranks are always
// computed over the FULL set first, so a top-3 display shows true ranks
// (1,2,2…), never ranks re-computed within the slice.
// allowedIds = self-scope pins (null = staff, full class).
export async function examResults(
  db: PrismaClient,
  examId: string,
  options: { top?: number; studentId?: string },
  allowedIds: string[] | null,
): Promise<{ exam: { id: string; name: string }; results: RankedResult[] }> {
  const exam = await db.exam.findFirst({
    where: { id: examId },
    include: { examSubjects: { select: { id: true, maxMarks: true } } },
  });
  if (!exam) {
    throw new AuthError(404, "EXAM_NOT_FOUND", "Exam not found in this school.");
  }
  if (options.studentId && allowedIds && !allowedIds.includes(options.studentId)) {
    throw new AuthError(403, "FORBIDDEN", "Not your record.");
  }
  const eligible =
    options.studentId ?? (allowedIds ? { in: allowedIds } : undefined);
  const marks = await db.mark.findMany({
    where: {
      examSubjectId: { in: exam.examSubjects.map((s) => s.id) },
      marksObtained: { not: null },
      ...(eligible === undefined ? {} : { studentId: typeof eligible === "string" ? eligible : eligible }),
    },
    select: {
      studentId: true,
      marksObtained: true,
      student: { select: { user: { select: { name: true } } } },
    },
  });

  const maxTotal = exam.examSubjects.reduce((sum, s) => sum + Number(s.maxMarks), 0);
  const totals = new Map<string, { name: string; total: number }>();
  for (const mark of marks) {
    const entry = totals.get(mark.studentId) ?? { name: mark.student.user.name, total: 0 };
    entry.total += Number(mark.marksObtained ?? 0);
    totals.set(mark.studentId, entry);
  }
  const entries = [...totals].map(([studentId, entry]) => ({ studentId, total: entry.total }));
  const ranks = rankAll(entries);

  let shown = entries.map((e) => e.studentId);
  if (options.top !== undefined) {
    if (options.top <= 0) {
      throw new AuthError(400, "VALIDATION_ERROR", "top must be a positive integer.");
    }
    shown = topK(entries, options.top);
  }
  const shownSet = new Set(shown);
  const results: RankedResult[] = [];
  for (const [studentId, entry] of totals) {
    if (!shownSet.has(studentId)) {
      continue;
    }
    const percent = percentOf(entry.total, maxTotal);
    results.push({
      studentId,
      name: entry.name,
      total: entry.total,
      max: maxTotal,
      percent,
      grade: gradeLetter(percent),
      rank: ranks.get(studentId) ?? 0,
    });
  }
  results.sort((a, b) => a.rank - b.rank || (a.studentId < b.studentId ? -1 : 1));
  return { exam: { id: exam.id, name: exam.name }, results };
}

// Single-student report card (§7 Phase 1 #4): per-subject marks + grades,
// totals, competition rank (over everyone who sat the exam), and attendance
// % pulled from the ATTENDANCE module's own summary — never recomputed
// here, so the two can never disagree. Range: the exam's dates when set,
// otherwise the trailing 30 days.
export async function reportCard(
  db: PrismaClient,
  examId: string,
  studentId: string,
): Promise<ReportCardData> {
  const exam = await db.exam.findFirst({
    where: { id: examId },
    include: {
      school: { select: { name: true, brandColor: true } },
      examSubjects: { include: { subject: { select: { name: true } } }, orderBy: { subject: { name: "asc" } } },
    },
  });
  if (!exam) {
    throw new AuthError(404, "EXAM_NOT_FOUND", "Exam not found in this school.");
  }
  const student = await db.student.findFirst({
    where: { id: studentId },
    include: {
      user: { select: { name: true } },
      section: { select: { name: true, class: { select: { name: true } } } },
    },
  });
  if (!student) {
    throw new AuthError(404, "NOT_FOUND", "Student not found.");
  }
  const marks = await db.mark.findMany({
    where: { examSubjectId: { in: exam.examSubjects.map((s) => s.id) } },
    select: { studentId: true, examSubjectId: true, marksObtained: true },
  });

  // Totals per taker for ranking (same helpers as the results board).
  const totals = new Map<string, number>();
  for (const mark of marks) {
    totals.set(mark.studentId, (totals.get(mark.studentId) ?? 0) + Number(mark.marksObtained ?? 0));
  }
  const ranks = rankAll([...totals].map(([id, total]) => ({ studentId: id, total })));

  const maxTotal = exam.examSubjects.reduce((sum, s) => sum + Number(s.maxMarks), 0);
  const bySubject = new Map(marks.filter((m) => m.studentId === studentId).map((m) => [m.examSubjectId, m]));
  const subjects = exam.examSubjects.map((s) => {
    const obtained = Number(bySubject.get(s.id)?.marksObtained ?? 0);
    const percent = percentOf(obtained, Number(s.maxMarks));
    return {
      name: s.subject.name,
      max: Number(s.maxMarks),
      obtained,
      percent,
      grade: gradeLetter(percent),
    };
  });
  const total = subjects.reduce((sum, s) => sum + s.obtained, 0);
  const percent = percentOf(total, maxTotal);

  let attendancePercent: number | null = null;
  let attendanceRange: string | null = null;
  if (exam.startDate && exam.endDate) {
    const range = await attendanceSummary(
      db,
      {
        from: exam.startDate.toISOString().slice(0, 10),
        to: exam.endDate.toISOString().slice(0, 10),
        studentId,
      },
      [studentId],
    );
    const row = range.summary.find((r) => r.studentId === studentId);
    if (row && row.total > 0) {
      attendancePercent = row.percent;
      attendanceRange = `${range.range.from} to ${range.range.to}`;
    }
  }

  return {
    schoolName: exam.school.name,
    brandColor: exam.school.brandColor ?? "#2563EB",
    examName: exam.name,
    studentName: student.user.name,
    admissionNo: student.admissionNo,
    className: student.section.class.name,
    sectionName: student.section.name,
    subjects,
    total,
    max: maxTotal,
    percent,
    grade: gradeLetter(percent),
    rank: ranks.get(studentId) ?? 0,
    rankedOutOf: totals.size,
    attendancePercent,
    attendanceRange,
  };
}
