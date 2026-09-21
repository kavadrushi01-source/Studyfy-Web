// Timetable auto-generation (§10, §11 graph coloring/CSP).
//
// Model: every required lesson (section × subject × period-instance) is a
// NODE. Two lessons share an EDGE when they cannot occupy the same slot —
// same section (a class attends one lesson at a time) or same teacher (a
// teacher teaches one class at a time). A "color" is a (day, period) slot
// plus a qualified, free teacher for it.
//
// Algorithm: greedy graph coloring in DSATUR-style order — most
// constrained lessons first (fewest qualified teachers, then most
// remaining periods). Each lesson takes the first slot where its section
// is free and a qualified teacher is free (least-loaded wins ties, which
// balances workloads instead of piling everything on teacher #1).
//
// Partial-result contract (spec §10: never crash or hang): lessons that
// fit nowhere are NOT retried forever — they land in `unresolved` with a
// machine-readable reason (NO_QUALIFIED_TEACHER vs NO_FREE_SLOT) and the
// rest still schedules. Every loop is bounded by days × periods, so
// termination is structural, not hoped for.

export interface LessonDemand {
  sectionId: string;
  subjectId: string;
  periods: number;
}

export interface TeacherQualification {
  teacherId: string;
  subjectIds: string[];
}

export interface PlacedSlot {
  sectionId: string;
  subjectId: string;
  teacherId: string;
  day: number;
  period: number;
}

export interface UnresolvedDemand {
  sectionId: string;
  subjectId: string;
  periodsMissing: number;
  reason: "NO_QUALIFIED_TEACHER" | "NO_FREE_SLOT";
}

export interface TimetableResult {
  placed: PlacedSlot[];
  unresolved: UnresolvedDemand[];
}

interface Lesson {
  sectionId: string;
  subjectId: string;
  teachers: string[];
}

export function generateTimetable(input: {
  demands: LessonDemand[];
  qualifications: TeacherQualification[];
  days: number[];
  periodsPerDay: number;
}): TimetableResult {
  const qualifiedBySubject = new Map<string, string[]>();
  for (const qual of input.qualifications) {
    for (const subjectId of qual.subjectIds) {
      const list = qualifiedBySubject.get(subjectId) ?? [];
      if (!list.includes(qual.teacherId)) {
        list.push(qual.teacherId);
      }
      qualifiedBySubject.set(subjectId, [...list].sort());
    }
  }

  const lessons: Lesson[] = [];
  for (const demand of input.demands) {
    const teachers = qualifiedBySubject.get(demand.subjectId) ?? [];
    for (let i = 0; i < demand.periods; i += 1) {
      lessons.push({ sectionId: demand.sectionId, subjectId: demand.subjectId, teachers });
    }
  }
  // Most constrained first: fewest qualified teachers, then section id for
  // determinism (identical input => identical timetable, every run).
  lessons.sort(
    (a, b) => a.teachers.length - b.teachers.length || (a.sectionId < b.sectionId ? -1 : 1),
  );

  const teacherBusy = new Map<string, Set<string>>();
  const sectionBusy = new Map<string, Set<string>>();
  const teacherLoad = new Map<string, number>();
  const key = (day: number, period: number): string => `${day}-${period}`;

  const placed: PlacedSlot[] = [];
  const missing = new Map<string, { sectionId: string; subjectId: string; count: number; reason: UnresolvedDemand["reason"] }>();

  for (const lesson of lessons) {
    if (lesson.teachers.length === 0) {
      const k = `${lesson.sectionId}|${lesson.subjectId}`;
      const entry = missing.get(k) ?? {
        sectionId: lesson.sectionId,
        subjectId: lesson.subjectId,
        count: 0,
        reason: "NO_QUALIFIED_TEACHER" as const,
      };
      entry.count += 1;
      missing.set(k, entry);
      continue;
    }
    let done = false;
    for (const day of input.days) {
      if (done) {
        break;
      }
      for (let period = 1; period <= input.periodsPerDay; period += 1) {
        const slot = key(day, period);
        if (sectionBusy.get(lesson.sectionId)?.has(slot)) {
          continue;
        }
        const free = lesson.teachers
          .filter((t) => !teacherBusy.get(t)?.has(slot))
          .sort((a, b) => (teacherLoad.get(a) ?? 0) - (teacherLoad.get(b) ?? 0) || (a < b ? -1 : 1));
        const teacher = free[0];
        if (!teacher) {
          continue;
        }
        placed.push({ sectionId: lesson.sectionId, subjectId: lesson.subjectId, teacherId: teacher, day, period });
        if (!sectionBusy.has(lesson.sectionId)) {
          sectionBusy.set(lesson.sectionId, new Set());
        }
        sectionBusy.get(lesson.sectionId)?.add(slot);
        if (!teacherBusy.has(teacher)) {
          teacherBusy.set(teacher, new Set());
        }
        teacherBusy.get(teacher)?.add(slot);
        teacherLoad.set(teacher, (teacherLoad.get(teacher) ?? 0) + 1);
        done = true;
        break;
      }
    }
    if (!done) {
      const k = `${lesson.sectionId}|${lesson.subjectId}`;
      const entry = missing.get(k) ?? {
        sectionId: lesson.sectionId,
        subjectId: lesson.subjectId,
        count: 0,
        reason: "NO_FREE_SLOT" as const,
      };
      entry.count += 1;
      missing.set(k, entry);
    }
  }

  return {
    placed,
    unresolved: [...missing.values()].map((m) => ({
      sectionId: m.sectionId,
      subjectId: m.subjectId,
      periodsMissing: m.count,
      reason: m.reason,
    })),
  };
}
