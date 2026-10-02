import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { generateTimetable, type PlacedSlot, type UnresolvedDemand } from "../../lib/timetable.js";
import { AuthError } from "../auth/auth.service.js";
import { invalidateTeacherBoards } from "../metrics/metrics.service.js";
import type { AddSlotInput, BoardQueryInput, GenerateTimetableInput } from "./timetable.schemas.js";

const MAX_LESSONS = 2000;

export interface GeneratedTimetable {
  placed: (PlacedSlot & { subjectName: string; teacherName: string })[];
  unresolved: (UnresolvedDemand & { subjectName: string })[];
}

// Generate + persist (§10): validate scope, run the coloring lib, REPLACE
// this generation's sections' old slots (regeneration is idempotent —
// running twice yields the same deterministic result, not duplicates),
// then return placed rows (with names for the UI) plus unresolved demand.
// Partial results are HTTP 200 with a non-empty unresolved list — never an
// error, never a hang (spec §10's rule).
export async function generateSectionTimetables(
  db: PrismaClient,
  input: GenerateTimetableInput,
): Promise<GeneratedTimetable> {
  const sectionIds = [...new Set(input.demands.map((d) => d.sectionId))];
  const sections = await db.section.findMany({ where: { id: { in: sectionIds } }, select: { id: true, schoolId: true } });
  if (sections.length !== sectionIds.length) {
    throw new AuthError(404, "SECTION_NOT_FOUND", "One or more sections were not found in this school.");
  }
  const schoolId = sections[0]?.schoolId;
  if (!schoolId) {
    throw new AuthError(404, "SECTION_NOT_FOUND", "One or more sections were not found in this school.");
  }
  const subjectIds = [...new Set(input.demands.map((d) => d.subjectId))];
  const subjects = await db.subject.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true } });
  if (subjects.length !== subjectIds.length) {
    throw new AuthError(404, "SUBJECT_NOT_FOUND", "One or more subjects were not found in this school.");
  }
  const subjectNames = new Map(subjects.map((s) => [s.id, s.name]));

  const totalLessons = input.demands.reduce((sum, d) => sum + d.periodsPerWeek, 0);
  if (totalLessons > MAX_LESSONS) {
    throw new AuthError(400, "VALIDATION_ERROR", `Too many lessons requested (max ${MAX_LESSONS}).`);
  }

  const quals = await db.teacherSubject.findMany({ select: { staffId: true, subjectId: true } });
  const byTeacher = new Map<string, string[]>();
  for (const q of quals) {
    const list = byTeacher.get(q.staffId) ?? [];
    list.push(q.subjectId);
    byTeacher.set(q.staffId, list);
  }

  const result = generateTimetable({
    demands: input.demands.map((d) => ({ sectionId: d.sectionId, subjectId: d.subjectId, periods: d.periodsPerWeek })),
    qualifications: [...byTeacher].map(([teacherId, subjectIds]) => ({ teacherId, subjectIds })),
    days: [...input.days].sort((a, b) => a - b),
    periodsPerDay: input.periodsPerDay,
  });

  // Replace: clear this generation's sections first (scoped delete can only
  // touch this tenant's rows), then insert the placed slots.
  await db.timetableSlot.deleteMany({ where: { sectionId: { in: sectionIds } } });
  for (const slot of result.placed) {
    await db.timetableSlot.create({
      data: {
        schoolId,
        sectionId: slot.sectionId,
        subjectId: slot.subjectId,
        teacherId: slot.teacherId,
        dayOfWeek: slot.day,
        period: slot.period,
      },
    });
  }

  const teacherNames = new Map<string, string>();
  if (result.placed.length > 0) {
    const teachers = await db.staff.findMany({
      where: { id: { in: [...new Set(result.placed.map((s) => s.teacherId))] } },
      select: { id: true, user: { select: { name: true } } },
    });
    for (const t of teachers) {
      teacherNames.set(t.id, t.user.name);
    }
  }
  // Persisted slots changed → teachers' "today" boards are stale (§12.3).
  invalidateTeacherBoards(schoolId);
  return {
    placed: result.placed.map((slot) => ({
      ...slot,
      subjectName: subjectNames.get(slot.subjectId) ?? "?",
      teacherName: teacherNames.get(slot.teacherId) ?? "?",
    })),
    unresolved: result.unresolved.map((u) => ({
      ...u,
      subjectName: subjectNames.get(u.subjectId) ?? "?",
    })),
  };
}

// Manual add (post-generation adjustment): enforces the SAME invariants
// the generator does — section free, teacher free — plus the qualification
// the generator gets structurally. Genuine exceptions go through the
// qualifications endpoint first (one source of truth, no silent bypass).
export async function addSlot(db: PrismaClient, input: AddSlotInput) {
  const [section, subject, staff] = await Promise.all([
    db.section.findFirst({ where: { id: input.sectionId } }),
    db.subject.findFirst({ where: { id: input.subjectId } }),
    db.staff.findFirst({ where: { id: input.teacherId }, include: { user: { select: { role: true } } } }),
  ]);
  if (!section) {
    throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
  }
  if (!subject) {
    throw new AuthError(404, "SUBJECT_NOT_FOUND", "Subject not found in this school.");
  }
  if (!staff || staff.user.role.name !== "TEACHER") {
    throw new AuthError(404, "TEACHER_NOT_FOUND", "No teacher with that id in this school.");
  }
  const qualified = await db.teacherSubject.findUnique({
    where: { staffId_subjectId: { staffId: staff.id, subjectId: subject.id } },
  });
  if (!qualified) {
    throw new AuthError(409, "TEACHER_NOT_QUALIFIED", "Assign the subject to the teacher first.");
  }
  const sectionClash = await db.timetableSlot.findFirst({
    where: { sectionId: section.id, dayOfWeek: input.dayOfWeek, period: input.period },
  });
  if (sectionClash) {
    throw new AuthError(409, "SLOT_TAKEN", "The section already has a lesson at that time.");
  }
  const teacherClash = await db.timetableSlot.findFirst({
    where: { teacherId: staff.id, dayOfWeek: input.dayOfWeek, period: input.period },
  });
  if (teacherClash) {
    throw new AuthError(409, "TEACHER_BUSY", "The teacher already teaches at that time.");
  }
  try {
    const slot = await db.timetableSlot.create({
      data: {
        schoolId: section.schoolId,
        sectionId: section.id,
        subjectId: subject.id,
        teacherId: staff.id,
        dayOfWeek: input.dayOfWeek,
        period: input.period,
      },
    });
    invalidateTeacherBoards(section.schoolId);
    return slot;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AuthError(409, "SLOT_TAKEN", "The section already has a lesson at that time.");
    }
    throw err;
  }
}

export async function deleteSlot(db: PrismaClient, slotId: string): Promise<void> {
  const slot = await db.timetableSlot.findFirst({ where: { id: slotId } });
  if (!slot) {
    throw new AuthError(404, "SLOT_NOT_FOUND", "Timetable slot not found.");
  }
  await db.timetableSlot.delete({ where: { id: slot.id } });
  invalidateTeacherBoards(slot.schoolId);
}

export interface BoardSectionOption {
  id: string;
  name: string;
  class: { name: string };
}

// Sections the caller may open a board for (§7 Phase 1 #5): pupils and
// parents hold timetable.read but NOT sections.read, so the full sections
// list is 403 for them and a picker fed only by /sections stays permanently
// empty (found by the human-check e2e — pupils could never see their own
// week). This returns exactly their pinned scope in the /sections shape:
// STUDENT → own section, PARENT → linked children's sections, TEACHER →
// own sections, ADMIN/ACCOUNTANT → every section in the school.
export async function boardSections(
  db: PrismaClient,
  viewer: { userId: string; role: string },
): Promise<{ sections: BoardSectionOption[] }> {
  const byId = (ids: string[]) =>
    db.section.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, class: { select: { name: true } } },
      orderBy: [{ class: { name: "asc" } }, { name: "asc" }],
    });
  if (viewer.role === "STUDENT") {
    const profile = await db.student.findFirst({ where: { userId: viewer.userId }, select: { sectionId: true } });
    return { sections: profile ? await byId([profile.sectionId]) : [] };
  }
  if (viewer.role === "PARENT") {
    const links = await db.studentGuardian.findMany({
      where: { parentId: viewer.userId },
      select: { student: { select: { sectionId: true } } },
    });
    return { sections: await byId([...new Set(links.map((l) => l.student.sectionId))]) };
  }
  if (viewer.role === "TEACHER") {
    const staff = await db.staff.findFirst({ where: { userId: viewer.userId }, select: { id: true } });
    if (!staff) {
      return { sections: [] };
    }
    const [owned, scheduled] = await Promise.all([
      db.section.findMany({ where: { classTeacherId: staff.id }, select: { id: true } }),
      db.timetableSlot.findMany({ where: { teacherId: staff.id }, select: { sectionId: true } }),
    ]);
    return {
      sections: await byId([...new Set([...owned.map((s) => s.id), ...scheduled.map((s) => s.sectionId)])]),
    };
  }
  const all = await db.section.findMany({
    select: { id: true, name: true, class: { select: { name: true } } },
    orderBy: [{ class: { name: "asc" } }, { name: "asc" }],
  });
  return { sections: all };
}

interface BoardCaller {
  userId: string;
  role: string;
}

export interface BoardSlot {
  id: string;
  dayOfWeek: number;
  period: number;
  subject: { id: string; name: string };
  teacher: { id: string; name: string };
  section: { id: string; name: string; className: string };
}

// Board read (§7 Phase 1 #5): section lens, teacher lens by id, or
// mine=true (teacher's own week from the session).
// - STUDENT/PARENT: section lens pinned to own/linked sections (resolved
//   from studentScope pins); teacher lens and mine always 403.
// - TEACHER: section lens pinned to own class-teacher sections; teacher
//   lens forced to self (another teacher's id => 403); mine resolves self.
// - ADMIN/ACCOUNTANT: either lens, any in-school id (scoped 404s foreign);
//   mine is meaningless without a teaching role => 403.
export async function readBoard(
  db: PrismaClient,
  caller: BoardCaller,
  studentScopeIds: string[] | null,
  input: BoardQueryInput,
): Promise<{ slots: BoardSlot[] }> {
  if (input.mine) {
    if (caller.role !== "TEACHER") {
      throw new AuthError(403, "FORBIDDEN", "Only teachers have a personal timetable.");
    }
    const self = await db.staff.findFirst({ where: { userId: caller.userId } });
    if (!self) {
      throw new AuthError(403, "FORBIDDEN", "No staff profile is linked to this account.");
    }
    return slotsFor(db, { teacherId: self.id });
  }
  if (caller.role === "STUDENT" || caller.role === "PARENT") {
    if (input.teacherId) {
      throw new AuthError(403, "FORBIDDEN", "Students and parents read section boards, not teacher boards.");
    }
    const students = await db.student.findMany({
      where: { id: { in: studentScopeIds ?? [] } },
      select: { sectionId: true },
    });
    const ownSections = [...new Set(students.map((s) => s.sectionId))];
    if (!input.sectionId || !ownSections.includes(input.sectionId)) {
      throw new AuthError(403, "FORBIDDEN", "Not your section.");
    }
    return slotsFor(db, { sectionId: input.sectionId });
  }

  if (caller.role === "TEACHER") {
    const staff = await db.staff.findFirst({ where: { userId: caller.userId } });
    if (!staff) {
      throw new AuthError(403, "FORBIDDEN", "No staff profile is linked to this account.");
    }
    if (input.teacherId) {
      if (input.teacherId !== staff.id) {
        throw new AuthError(403, "FORBIDDEN", "Teachers read only their own timetable.");
      }
      return slotsFor(db, { teacherId: staff.id });
    }
    const owned = await db.section.findMany({ where: { classTeacherId: staff.id }, select: { id: true } });
    const ownIds = owned.map((s) => s.id);
    if (!input.sectionId || !ownIds.includes(input.sectionId)) {
      throw new AuthError(403, "FORBIDDEN", "Teachers read only their own sections.");
    }
    return slotsFor(db, { sectionId: input.sectionId });
  }

  if (input.sectionId) {
    const section = await db.section.findFirst({ where: { id: input.sectionId } });
    if (!section) {
      throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
    }
    return slotsFor(db, { sectionId: section.id });
  }
  const staff = await db.staff.findFirst({ where: { id: input.teacherId } });
  if (!staff) {
    throw new AuthError(404, "TEACHER_NOT_FOUND", "No teacher with that id in this school.");
  }
  return slotsFor(db, { teacherId: staff.id });
}

async function slotsFor(
  db: PrismaClient,
  filter: { sectionId: string } | { teacherId: string },
): Promise<{ slots: BoardSlot[] }> {
  const slots = await db.timetableSlot.findMany({
    where: filter,
    include: {
      subject: { select: { id: true, name: true } },
      teacher: { select: { id: true, user: { select: { name: true } } } },
      section: { select: { id: true, name: true, class: { select: { name: true } } } },
    },
    orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }],
  });
  return {
    slots: slots.map((s) => ({
      id: s.id,
      dayOfWeek: s.dayOfWeek,
      period: s.period,
      subject: { id: s.subject.id, name: s.subject.name },
      teacher: { id: s.teacher.id, name: s.teacher.user.name },
      section: { id: s.section.id, name: s.section.name, className: s.section.class.name },
    })),
  };
}
