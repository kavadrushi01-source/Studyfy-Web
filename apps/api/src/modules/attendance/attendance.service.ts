import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import type { MarkAttendanceInput } from "./attendance.schemas.js";

interface Caller {
  userId: string;
  role: string;
}

// Bulk mark (§10, §12.2): INSERT ... ON DUPLICATE KEY UPDATE semantics —
// re-marking the same day overwrites instead of duplicating, keyed by the
// (studentId, date) unique constraint. Implemented as one transaction of
// row upserts (identical outcome to a single raw statement at section
// scale; the raw-SQL form buys nothing until sections reach thousands).
//
// Authorization (§9.1 classTeacherId note): the section's assigned class
// teacher, or a School Admin. Any other teacher — even one teaching in the
// same school — gets 403. This is the check the class-teacher assignment
// exists to serve, separate from the full Timetable (Chunk 3).
export async function markAttendance(
  db: PrismaClient,
  caller: Caller,
  input: MarkAttendanceInput,
): Promise<{ marked: number }> {
  const section = await db.section.findFirst({ where: { id: input.sectionId } });
  if (!section) {
    throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
  }

  let markedById: string | null = null;
  if (caller.role !== "SCHOOL_ADMIN") {
    const staff = await db.staff.findFirst({ where: { userId: caller.userId } });
    if (!staff || section.classTeacherId !== staff.id) {
      throw new AuthError(
        403,
        "NOT_SECTION_TEACHER",
        "Only the section's class teacher or a School Admin may mark its attendance.",
      );
    }
    markedById = staff.id;
  }

  const date = new Date(`${input.date}T00:00:00Z`);
  const studentIds = input.records.map((r) => r.studentId);
  const members = await db.student.findMany({
    where: { id: { in: studentIds }, sectionId: section.id },
    select: { id: true },
  });
  const memberIds = new Set(members.map((m) => m.id));
  const outsiders = studentIds.filter((id) => !memberIds.has(id));
  if (outsiders.length > 0) {
    throw new AuthError(400, "STUDENT_NOT_IN_SECTION", "Every marked student must belong to the section.");
  }

  await db.$transaction(
    input.records.map((record) =>
      db.attendance.upsert({
        where: { studentId_date: { studentId: record.studentId, date } },
        update: { status: record.status, sectionId: section.id, markedById },
        create: {
          schoolId: section.schoolId,
          studentId: record.studentId,
          sectionId: section.id,
          date,
          status: record.status,
          markedById,
        },
      }),
    ),
  );
  return { marked: input.records.length };
}
