import type { PrismaClient } from "@prisma/client";
import { pickAuditFields } from "../../lib/audit.js";
import { gradeLetter, percentOf, rankAll, topK } from "../../lib/grades.js";
import { GroqApiError, GroqUnconfiguredError, groq } from "../../lib/groq.js";
import type { ReportCardData } from "../../lib/report-card.js";
import { AuthError } from "../auth/auth.service.js";
import { schoolDay } from "../../lib/school-time.js";
import { attendanceSummary } from "../attendance/attendance.service.js";
import { invalidateActivityFeed, invalidateStudentBoards, invalidateTeacherBoards } from "../metrics/metrics.service.js";
import { invalidateAnalytics } from "../metrics/analytics.service.js";
import type { CreateExamInput, EnterMarksInput, GenerateRemarkInput, ReviewRemarkInput } from "./exams.schemas.js";

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

  // Audit (§13.10 MARK_CREATE/MARK_UPDATE with before/after scores) rides
  // in the SAME array transaction as the upserts: pre-fetch tells creates
  // apart from overwrites, and the log rows commit with the marks or not
  // at all. Snapshots go through pickAuditFields (scores as numbers —
  // Decimals are objects, not scalars).
  const previous = await db.mark.findMany({
    where: { examSubjectId: examSubject.id, studentId: { in: studentIds } },
    select: { studentId: true, marksObtained: true },
  });
  const beforeByStudent = new Map(previous.map((m) => [m.studentId, m.marksObtained]));
  const ops = [];
  for (const record of input.records) {
    ops.push(
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
    );
    const old = beforeByStudent.get(record.studentId);
    const snapshot = { studentId: record.studentId, examSubjectId: examSubject.id, score: record.marksObtained };
    ops.push(
      db.auditLog.create({
        data: {
          schoolId: section.schoolId,
          actorId: caller.userId,
          action: old === undefined ? "MARK_CREATE" : "MARK_UPDATE",
          entity: "Mark",
          entityId: record.studentId,
          ...(old !== undefined
            ? { before: pickAuditFields("Mark", { ...snapshot, score: old === null ? null : Number(old) }) }
            : {}),
          after: pickAuditFields("Mark", snapshot),
        },
      }),
    );
  }
  await db.$transaction(ops);
  // New scores → graded students' boards are stale (§12.3).
  invalidateStudentBoards(section.schoolId);
  invalidateAnalytics(section.schoolId);
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

// Saved marks for one exam subject + section (entry-form prefill): every
// pupil of the section with their saved mark or null. Same gate as entry
// (class teacher or admin) so no pupil ever reads another's marks here.
export async function savedMarks(
  db: PrismaClient,
  examId: string,
  caller: MarksCaller,
  input: { examSubjectId: string; sectionId: string },
): Promise<{ marks: { studentId: string; name: string; marksObtained: number | null }[] }> {
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
        "Only the section's class teacher or a School Admin may read its marks.",
      );
    }
  }
  const pupils = await db.student.findMany({
    where: { sectionId: section.id },
    select: {
      id: true,
      user: { select: { name: true } },
      marks: { where: { examSubjectId: examSubject.id }, select: { marksObtained: true } },
    },
    orderBy: { user: { name: "asc" } },
  });
  return {
    marks: pupils.map((p) => ({
      studentId: p.id,
      name: p.user.name,
      marksObtained: p.marks.length > 0 ? Number(p.marks[0]?.marksObtained ?? null) : null,
    })),
  };
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
  // Ranks come from EVERY taker's marks — self-scope pins only choose WHICH
  // rows are returned, never the pool ranks are computed from. Filtering
  // the query by pins first made a pinned pupil "#1 of 1" (a parent shown
  // a false #1); the subtitle promises whole-class ranks, so the filter
  // happens after ranking, below.
  const marks = await db.mark.findMany({
    where: {
      examSubjectId: { in: exam.examSubjects.map((s) => s.id) },
      marksObtained: { not: null },
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

  const visibleIds = options.studentId
    ? [options.studentId]
    : allowedIds
      ? entries.map((e) => e.studentId).filter((id) => allowedIds.includes(id))
      : entries.map((e) => e.studentId);
  let shown = visibleIds;
  if (options.top !== undefined) {
    if (options.top <= 0) {
      throw new AuthError(400, "VALIDATION_ERROR", "top must be a positive integer.");
    }
    shown = topK(
      entries.filter((e) => visibleIds.includes(e.studentId)),
      options.top,
    );
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

// Trailing-30-day fallback for dateless exams: the current school day and
// the 29 school days before it, inclusive.
function trailingThirtyDays(timezone: string, now: Date = new Date()): { from: string; to: string } {
  const to = schoolDay(timezone, now);
  const from = schoolDay(timezone, new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  return { from, to };
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
      school: { select: { name: true, brandColor: true, timezone: true } },
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
  {
    const window =
      exam.startDate && exam.endDate
        ? {
            from: exam.startDate.toISOString().slice(0, 10),
            to: exam.endDate.toISOString().slice(0, 10),
          }
        : trailingThirtyDays(exam.school.timezone);
    const range = await attendanceSummary(
      db,
      { ...window, studentId },
      [studentId],
      { timezone: exam.school.timezone },
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
    rank: ranks.get(studentId) ?? null,
    rankedOutOf: totals.size,
    attendancePercent,
    attendanceRange,
    remark: await latestReviewedRemark(db, exam.id, studentId),
  };
}

// The card pulls the SAVED remark (§7 Phase 3 #18) — newest reviewed row
// for this pupil+exam — never a fresh Groq call. Unreviewed AI drafts are
// invisible here by construction: no reviewed row, no remark on the card.
async function latestReviewedRemark(
  db: PrismaClient,
  examId: string,
  studentId: string,
): Promise<{ text: string; generatedBy: string } | null> {
  const row = await db.examRemark.findFirst({
    where: { examId, studentId, reviewed: true },
    orderBy: { createdAt: "desc" },
    select: { remark: true, generatedBy: true },
  });
  return row ? { text: row.remark, generatedBy: row.generatedBy } : null;
}

// AI report-card remark (§7 Phase 3 #18): given one pupil's marks and
// attendance for an exam, draft a short remark via the Groq wrapper and
// store it as an UNREVIEWED AI row — a teacher signs it off separately,
// unreviewed text never reaches a report card.
//
// PII rule (spec §7, explicit): the prompt carries subject scores and an
// attendance % only, and the pupil is "this student" throughout. The
// student's name is never even SELECTED below, so it cannot leak into the
// prompt by accident — the wrapper's minimizePii is the second layer, not
// the first. Same class-teacher-or-admin relationship as marks entry,
// resolved through the PUPIL's own section.
export function buildRemarkPrompt(examName: string, subjectLines: string[], attendancePercent: number | null): string {
  const lines = [
    "Write a one-line report card remark for this student.",
    `Exam: ${examName}`,
    ...subjectLines,
  ];
  if (attendancePercent !== null) {
    lines.push(`Attendance during the exam window: ${attendancePercent}%.`);
  }
  lines.push('Keep it to one or two sentences, warm and specific. Refer to the pupil only as "this student".');
  return lines.join("\n");
}

export async function generateRemark(
  db: PrismaClient,
  examId: string,
  caller: MarksCaller,
  input: GenerateRemarkInput,
): Promise<{ remark: { id: string; remark: string; generatedBy: string; reviewed: boolean } }> {
  const exam = await db.exam.findFirst({
    where: { id: examId },
    include: {
      examSubjects: { include: { subject: { select: { name: true } } } },
      school: { select: { timezone: true } },
    },
  });
  if (!exam) {
    throw new AuthError(404, "EXAM_NOT_FOUND", "Exam not found in this school.");
  }
  // No user/name selected here by design — see the PII note above.
  const student = await db.student.findFirst({
    where: { id: input.studentId },
    select: { id: true, schoolId: true, section: { select: { classTeacherId: true } } },
  });
  if (!student) {
    throw new AuthError(404, "NOT_FOUND", "Student not found.");
  }
  if (caller.role !== "SCHOOL_ADMIN") {
    const staff = await db.staff.findFirst({ where: { userId: caller.userId } });
    if (!staff || student.section.classTeacherId !== staff.id) {
      throw new AuthError(
        403,
        "NOT_SECTION_TEACHER",
        "Only the section's class teacher or a School Admin may generate its remarks.",
      );
    }
  }

  const marks = await db.mark.findMany({
    where: { studentId: student.id, examSubjectId: { in: exam.examSubjects.map((s) => s.id) } },
    select: { examSubjectId: true, marksObtained: true },
  });
  const bySubject = new Map(marks.map((m) => [m.examSubjectId, Number(m.marksObtained ?? 0)]));
  const subjectLines = exam.examSubjects.map((s) => {
    const max = Number(s.maxMarks);
    const obtained = bySubject.get(s.id) ?? 0;
    return `${s.subject.name}: ${obtained}/${max} (${gradeLetter(percentOf(obtained, max))})`;
  });

  // Attendance comes from the attendance module's own summary — same exam
  // window rule as the report card, never recomputed here.
  let attendancePercent: number | null = null;
  {
    const window =
      exam.startDate && exam.endDate
        ? {
            from: exam.startDate.toISOString().slice(0, 10),
            to: exam.endDate.toISOString().slice(0, 10),
          }
        : trailingThirtyDays(exam.school.timezone);
    const range = await attendanceSummary(
      db,
      { ...window, studentId: student.id },
      [student.id],
      { timezone: exam.school.timezone },
    );
    const row = range.summary.find((r) => r.studentId === student.id);
    if (row && row.total > 0) {
      attendancePercent = row.percent;
    }
  }

  let text: string;
  try {
    text = await groq().generateText({ prompt: buildRemarkPrompt(exam.name, subjectLines, attendancePercent) });
  } catch (err) {
    if (err instanceof GroqUnconfiguredError) {
      throw new AuthError(503, "AI_UNCONFIGURED", "AI remarks are not configured yet.");
    }
    if (err instanceof GroqApiError) {
      throw new AuthError(502, "AI_GENERATION_FAILED", "The AI remark could not be generated. Try again.");
    }
    throw err;
  }

  const saved = await db.examRemark.create({
    data: {
      schoolId: exam.schoolId,
      studentId: student.id,
      examId: exam.id,
      remark: text,
      generatedBy: "AI",
      reviewed: false,
    },
  });
  return { remark: { id: saved.id, remark: saved.remark, generatedBy: saved.generatedBy, reviewed: saved.reviewed } };
}

export interface RemarkRow {
  id: string;
  remark: string;
  generatedBy: string;
  reviewed: boolean;
  createdAt: Date;
}

// One pupil's remarks, newest first — the teacher's review queue for the
// report card page. Same class-teacher-or-admin relationship as generation,
// resolved through the pupil's own section.
export async function listRemarks(
  db: PrismaClient,
  examId: string,
  caller: MarksCaller,
  studentId: string,
): Promise<{ remarks: RemarkRow[] }> {
  const exam = await db.exam.findFirst({ where: { id: examId }, select: { id: true } });
  if (!exam) {
    throw new AuthError(404, "EXAM_NOT_FOUND", "Exam not found in this school.");
  }
  const student = await db.student.findFirst({
    where: { id: studentId },
    select: { id: true, section: { select: { classTeacherId: true } } },
  });
  if (!student) {
    throw new AuthError(404, "NOT_FOUND", "Student not found.");
  }
  if (caller.role !== "SCHOOL_ADMIN") {
    const staff = await db.staff.findFirst({ where: { userId: caller.userId } });
    if (!staff || student.section.classTeacherId !== staff.id) {
      throw new AuthError(
        403,
        "NOT_SECTION_TEACHER",
        "Only the section's class teacher or a School Admin may read its remarks.",
      );
    }
  }
  const rows = await db.examRemark.findMany({
    where: { examId: exam.id, studentId: student.id },
    orderBy: { createdAt: "desc" },
  });
  return {
    remarks: rows.map((r) => ({
      id: r.id,
      remark: r.remark,
      generatedBy: r.generatedBy,
      reviewed: r.reviewed,
      createdAt: r.createdAt,
    })),
  };
}

// Teacher review (§7 Phase 3 #18): edit the draft text and/or flip
// reviewed. The remark must belong to the exam in the URL — a row from
// another exam (or school, via tenant scoping) 404s instead of moving.
export async function reviewRemark(
  db: PrismaClient,
  examId: string,
  caller: MarksCaller,
  remarkId: string,
  input: ReviewRemarkInput,
): Promise<{ remark: RemarkRow }> {
  const row = await db.examRemark.findFirst({
    where: { id: remarkId },
    select: {
      id: true,
      examId: true,
      student: { select: { section: { select: { classTeacherId: true } } } },
    },
  });
  if (!row || row.examId !== examId) {
    throw new AuthError(404, "REMARK_NOT_FOUND", "Remark not found for this exam.");
  }
  if (caller.role !== "SCHOOL_ADMIN") {
    const staff = await db.staff.findFirst({ where: { userId: caller.userId } });
    if (!staff || row.student.section.classTeacherId !== staff.id) {
      throw new AuthError(
        403,
        "NOT_SECTION_TEACHER",
        "Only the section's class teacher or a School Admin may review its remarks.",
      );
    }
  }
  const updated = await db.examRemark.update({
    where: { id: row.id },
    data: {
      ...(input.remark !== undefined ? { remark: input.remark } : {}),
      ...(input.reviewed !== undefined ? { reviewed: input.reviewed } : {}),
    },
  });
  return {
    remark: {
      id: updated.id,
      remark: updated.remark,
      generatedBy: updated.generatedBy,
      reviewed: updated.reviewed,
      createdAt: updated.createdAt,
    },
  };
}
