import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import { documentStorage, StorageUnconfiguredError } from "../../lib/storage.js";
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
  });
}

export const SUBMISSION_ALLOWED: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};

export const SUBMISSION_MAX_BYTES = 5 * 1024 * 1024;

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
// (§13.5): whitelist + 5 MB + schools/{schoolId}/ folder. Re-submitting
// overwrites and reopens (back to SUBMITTED).
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
      throw new AuthError(413, "FILE_TOO_LARGE", "Files must be 5 MB or smaller.");
    }
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
  });
}

// Teacher grading: same authorship gate as posting (qualified subject +
// class-teacher-or-scheduled section, or Admin). Grading flips SUBMITTED
// to GRADED; anything else stays as the teacher left it.
export async function gradeSubmission(db: PrismaClient, caller: { userId: string; role: string }, submissionId: string) {
  const submission = await db.homeworkSubmission.findFirst({
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
  return db.homeworkSubmission.update({
    where: { id: submission.id },
    data: { status: "GRADED" },
  });
}
