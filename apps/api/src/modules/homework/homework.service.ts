import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
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
