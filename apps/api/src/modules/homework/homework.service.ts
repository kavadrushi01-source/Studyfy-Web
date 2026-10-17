import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import { documentStorage, StorageUnconfiguredError } from "../../lib/storage.js";
import { assertDemoUploadAllowed } from "../../lib/upload-caps.js";
import { invalidateActivityFeed, invalidateTeacherBoards } from "../metrics/metrics.service.js";
import type { PostHomeworkInput } from "./homework.schemas.js";

interface HomeworkCaller {
  userId: string;
  role: string;
}

// Posting (§7 Phase 1 #6): School Admin always; a teacher only for a
// subject/section they ACTUALLY teach — qualified for the subject
// (teacher_subjects) AND (class teacher of the section OR already holding
// a timetable slot for it). This is the tightened gate the marks-entry
// box deferred to Chunk 3: per-subject relationship, not just homeroom.
export async function postHomework(db: PrismaClient, caller: HomeworkCaller, input: PostHomeworkInput) {
  const [section, subject] = await Promise.all([
    db.section.findFirst({ where: { id: input.sectionId } }),
    db.subject.findFirst({ where: { id: input.subjectId } }),
  ]);
  if (!section) {
    throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
  }
  if (!subject) {
    throw new AuthError(404, "SUBJECT_NOT_FOUND", "Subject not found in this school.");
  }

  let teacherId: string | null = null;
  if (caller.role !== "SCHOOL_ADMIN") {
    const staff = await db.staff.findFirst({ where: { userId: caller.userId } });
    if (!staff) {
      throw new AuthError(403, "FORBIDDEN", "No staff profile is linked to this account.");
    }
    const qualified = await db.teacherSubject.findUnique({
      where: { staffId_subjectId: { staffId: staff.id, subjectId: subject.id } },
    });
    const classTeacher = section.classTeacherId === staff.id;
    const scheduled =
      !classTeacher &&
      (await db.timetableSlot.findFirst({ where: { sectionId: section.id, teacherId: staff.id } }));
    if (!qualified || (!classTeacher && !scheduled)) {
      throw new AuthError(
        403,
        "NOT_SUBJECT_TEACHER",
        "Only a teacher of this subject and section may post its homework.",
      );
    }
    teacherId = staff.id;
  } else {
    // Admin posts attribute to the section's class teacher when one exists
    // (their name shows on the assignment); otherwise fall through below.
    teacherId = section.classTeacherId;
  }
  if (!teacherId) {
    // No class teacher and not a teacher-author: pick any qualified teacher
    // so the row always has an owner (deterministic: lowest staff id).
    const qualified = await db.teacherSubject.findFirst({
      where: { subjectId: subject.id },
      orderBy: { staffId: "asc" },
    });
    if (!qualified) {
      throw new AuthError(409, "NO_QUALIFIED_TEACHER", "No teacher is qualified for this subject yet.");
    }
    teacherId = qualified.staffId;
  }

  return db.homework.create({
    data: {
      schoolId: section.schoolId,
      sectionId: section.id,
      subjectId: subject.id,
      teacherId,
      title: input.title,
      description: input.description,
      dueDate: new Date(`${input.dueDate}T00:00:00Z`),
    },
    include: {
      subject: { select: { name: true } },
      teacher: { select: { user: { select: { name: true } } } },
    },
  }).then((homework) => {
    // New assignment → the activities feed and the teacher's upcoming list
    // are stale (§12.3).
    invalidateActivityFeed(section.schoolId);
    invalidateTeacherBoards(section.schoolId);
    return homework;
  });
}

export const SUBMISSION_ALLOWED: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};

// Small files only (founder decision — keeps storage/DB light for a free
// tier): 2 MB per submission file, one file per submission (the model
// holds a single fileUrl). Size is checked before anything is stored.
export const SUBMISSION_MAX_BYTES = 2 * 1024 * 1024;

// Magic-byte check: a renamed .exe/.html saved as .pdf uploads "fine" and
// then dies in every viewer with "Failed to load PDF document". Reject
// impostors at submit time with a message that names the actual problem.
function fileSignatureOk(mimetype: string, buffer: Buffer): boolean {
  if (buffer.length < 8) {
    return false;
  }
  if (mimetype === "application/pdf") {
    return buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46 && buffer[4] === 0x2d;
  }
  if (mimetype === "image/jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimetype === "image/png") {
    return (
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
    );
  }
  if (mimetype === "image/webp") {
    return (
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    );
  }
  return false;
}

export interface SubmissionFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

// Student submission (§7 Phase 1 #6): text and/or file. Own section's
// homework only — submitting to another section's assignment is 403, same
// fail-closed shape as self-scope. File rules mirror admission documents
// (§13.5): whitelist + magic-byte check + 2 MB + schools/{schoolId}/
// folder. Re-submitting overwrites and reopens (back to SUBMITTED).
export async function submitHomework(
  db: PrismaClient,
  callerUserId: string,
  homeworkId: string,
  content: string | undefined,
  file: SubmissionFile | undefined,
) {
  const homework = await db.homework.findFirst({ where: { id: homeworkId } });
  if (!homework) {
    throw new AuthError(404, "HOMEWORK_NOT_FOUND", "Homework not found.");
  }
  const profile = await db.student.findFirst({ where: { userId: callerUserId } });
  if (!profile || profile.sectionId !== homework.sectionId) {
    throw new AuthError(403, "NOT_YOUR_HOMEWORK", "You can only submit your own section's homework.");
  }
  if ((!content || content.length === 0) && !file) {
    throw new AuthError(400, "VALIDATION_ERROR", "Submit text, a file, or both.");
  }
  let fileUrl: string | undefined;
  if (file) {
    const extensions = SUBMISSION_ALLOWED[file.mimetype];
    if (!extensions || !extensions.includes(extOf(file.originalname))) {
      throw new AuthError(415, "UNSUPPORTED_FILE_TYPE", "Only JPEG, PNG, WebP images and PDF files are accepted.");
    }
    if (file.size > SUBMISSION_MAX_BYTES) {
      throw new AuthError(413, "FILE_TOO_LARGE", "Files must be 2 MB or smaller — small PDFs and photos keep the site fast for everyone.");
    }
    if (!fileSignatureOk(file.mimetype, file.buffer)) {
      throw new AuthError(
        415,
        "FILE_CONTENT_MISMATCH",
        "That file is not actually a PDF/image — renamed files cannot be opened later. Please attach the real file.",
      );
    }
    // Demo quota guard (§13.11): before bytes reach storage.
    await assertDemoUploadAllowed(db, homework.schoolId, file.size);
    try {
      const stored = await documentStorage().upload({
        buffer: file.buffer,
        schoolId: homework.schoolId,
        mimeType: file.mimetype,
        originalName: file.originalname,
      });
      fileUrl = stored.url;
    } catch (err) {
      if (err instanceof StorageUnconfiguredError) {
        throw new AuthError(503, "STORAGE_UNCONFIGURED", err.message);
      }
      throw err;
    }
  }
  return db.homeworkSubmission.upsert({
    where: { homeworkId_studentId: { homeworkId: homework.id, studentId: profile.id } },
    update: {
      ...(content !== undefined ? { content } : {}),
      ...(fileUrl !== undefined ? { fileUrl } : {}),
      status: "SUBMITTED",
    },
    create: {
      schoolId: homework.schoolId,
      homeworkId: homework.id,
      studentId: profile.id,
      content,
      fileUrl,
      status: "SUBMITTED",
    },
  }).then((submission) => {
    // New submission → the teacher's pending count is stale (§12.3). This
    // was the actual "pending never moves" report: post + grade
    // invalidated, submit did not, so the count lagged up to the 60s TTL.
    invalidateTeacherBoards(homework.schoolId);
    return submission;
  });
}

// Teacher grading: same authorship gate as posting (qualified subject +
// class-teacher-or-scheduled section, or Admin). Grading flips SUBMITTED
// to GRADED; anything else stays as the teacher left it.
export async function gradeSubmission(db: PrismaClient, caller: { userId: string; role: string }, submissionId: string) {  const submission = await db.homeworkSubmission.findFirst({
    where: { id: submissionId },
    include: { homework: { select: { sectionId: true, subjectId: true } } },
  });
  if (!submission) {
    throw new AuthError(404, "SUBMISSION_NOT_FOUND", "Submission not found.");
  }
  if (caller.role !== "SCHOOL_ADMIN") {
    const staff = await db.staff.findFirst({ where: { userId: caller.userId } });
    const section = await db.section.findFirst({ where: { id: submission.homework.sectionId } });
    const qualified =
      staff &&
      (await db.teacherSubject.findUnique({
        where: { staffId_subjectId: { staffId: staff.id, subjectId: submission.homework.subjectId } },
      }));
    const classTeacher = !!section && !!staff && section.classTeacherId === staff.id;
    const scheduled =
      !classTeacher &&
      !!staff &&
      (await db.timetableSlot.findFirst({
        where: { sectionId: submission.homework.sectionId, teacherId: staff.id },
      }));
    if (!staff || !qualified || (!classTeacher && !scheduled)) {
      throw new AuthError(403, "NOT_SUBJECT_TEACHER", "Only the section's subject teacher may grade this.");
    }
  }
  const graded = await db.homeworkSubmission.update({
    where: { id: submission.id },
    data: { status: "GRADED" },
  });
  // Pending count dropped → the grader's board is stale (§12.3).
  invalidateTeacherBoards(submission.schoolId);
  return graded;
}

interface BoardCaller {
  userId: string;
  role: string;
}

export interface BoardItem {
  id: string;
  title: string;
  description: string;
  dueDate: string;
  subject: { name: string };
  section: { id: string; name: string; className: string };
  teacher: { name: string };
  // Present for STUDENT/PARENT: their (or linked children's) submissions.
  mySubmissions: { studentId: string; status: string }[];
  // Present for staff: grading workload per assignment.
  counts: { total: number; submitted: number; graded: number } | null;
  // Staff only: ungraded submissions with author names AND the work
  // itself (answer text + file link + submitted time), so the teacher
  // reads the homework right here before marking it graded — no ID
  // hunting, no blind grading (null for students/parents — submission
  // ids AND contents of other pupils must never leak to them).
  pending:
    | { id: string; studentName: string; content: string | null; fileUrl: string | null; submittedAt: string }[]
    | null;
}

// Homework board (§7 Phase 1 #6): one endpoint, role-shaped rows.
// - STUDENT/PARENT: homework for pinned students' sections, each with
//   THEIR submission states (null = not submitted yet). The client splits
//   pending vs graded from exactly this — no second call.
// - TEACHER: only rows THEY authored, each with submitted/graded counts,
//   so "what needs grading" is one glance (pending = submitted - graded).
// - ADMIN: everything with counts. (Accountant holds no homework.read.)
export async function homeworkBoard(
  db: PrismaClient,
  caller: BoardCaller,
  studentScopeIds: string[] | null,
): Promise<{ homework: BoardItem[] }> {
  if (caller.role === "STUDENT" || caller.role === "PARENT") {
    const students = await db.student.findMany({
      where: { id: { in: studentScopeIds ?? [] } },
      select: { id: true, sectionId: true },
    });
    const sectionIds = [...new Set(students.map((s) => s.sectionId))];
    const pinned = new Set(students.map((s) => s.id));
    const rows = await db.homework.findMany({
      where: { sectionId: { in: sectionIds } },
      include: {
        subject: { select: { name: true } },
        section: { select: { id: true, name: true, class: { select: { name: true } } } },
        teacher: { select: { user: { select: { name: true } } } },
        submissions: { where: { studentId: { in: [...pinned] } }, select: { studentId: true, status: true } },
      },
      orderBy: { dueDate: "asc" },
      // 500, not 100: far-future-dated cards must stay visible while old
      // backlog accumulates, or newly posted homework silently vanishes.
      take: 500,
    });
    return {
      homework: rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        dueDate: row.dueDate.toISOString().slice(0, 10),
        subject: { name: row.subject.name },
        section: { id: row.section.id, name: row.section.name, className: row.section.class.name },
        teacher: { name: row.teacher.user.name },
        mySubmissions: row.submissions.map((s) => ({ studentId: s.studentId, status: s.status })),
        counts: null,
        pending: null,
      })),
    };
  }

  let teacherId: string | null = null;
  if (caller.role === "TEACHER") {
    const staff = await db.staff.findFirst({ where: { userId: caller.userId } });
    if (!staff) {
      throw new AuthError(403, "FORBIDDEN", "No staff profile is linked to this account.");
    }
    teacherId = staff.id;
  }
  const rows = await db.homework.findMany({
    where: teacherId ? { teacherId } : {},
    include: {
      subject: { select: { name: true } },
      section: { select: { id: true, name: true, class: { select: { name: true } } } },
      teacher: { select: { user: { select: { name: true } } } },
      submissions: {
        select: {
          id: true,
          status: true,
          content: true,
          fileUrl: true,
          submittedAt: true,
          student: { select: { user: { select: { name: true } } } },
        },
        orderBy: { submittedAt: "asc" },
        take: 100,
      },
    },
    orderBy: { dueDate: "asc" },
    // 500, not 100: same backlog reasoning as the pupil branch above.
    take: 500,
  });
  return {
    homework: rows.map((row) => {
      const submitted = row.submissions.filter((s) => s.status !== "DRAFT").length;
      const graded = row.submissions.filter((s) => s.status === "GRADED").length;
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        dueDate: row.dueDate.toISOString().slice(0, 10),
        subject: { name: row.subject.name },
        section: { id: row.section.id, name: row.section.name, className: row.section.class.name },
        teacher: { name: row.teacher.user.name },
        mySubmissions: [],
        counts: { total: row.submissions.length, submitted, graded },
        pending: row.submissions
          .filter((s) => s.status === "SUBMITTED")
          .slice(0, 20)
          .map((s) => ({
            id: s.id,
            studentName: s.student.user.name,
            content: s.content,
            fileUrl: s.fileUrl,
            submittedAt: s.submittedAt.toISOString(),
          })),
      };
    }),
  };
}
