import type { PrismaClient } from "@prisma/client";
import { detectAnomalies, type AnomalyDay, type AttendanceAnomaly } from "../../lib/attendance-anomalies.js";
import { GroqApiError, GroqUnconfiguredError, groq } from "../../lib/groq.js";
import { mailer, MailerUnconfiguredError } from "../../lib/mailer.js";
import { AuthError } from "../auth/auth.service.js";
import { invalidateAttendanceKpis, invalidateStudentBoards, invalidateTeacherBoards } from "../metrics/metrics.service.js";
import type { AnomaliesInput, MarkAttendanceInput, RosterInput, SummaryInput } from "./attendance.schemas.js";

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

  // Absentee alerts (§7 Phase 1 #2): EVERY linked guardian gets one — the
  // join table means plural by default, so iterate links, not students.
  // Best-effort by design: email must never fail a marking. Failures are
  // logged with the student/day for the office to follow up on.
  const absentIds = input.records.filter((r) => r.status === "ABSENT").map((r) => r.studentId);
  if (absentIds.length > 0) {
    await sendAbsenteeAlerts(db, section.schoolId, absentIds, input.date).catch((err: unknown) => {
      console.error("Absentee alerts failed after successful marking:", err);
    });
  }
  // Marks changed → today's cached attendance % for this school is stale,
  // and so are the affected teachers' "today" boards and the marked
  // students' boards (§12.3).
  invalidateAttendanceKpis(section.schoolId);
  invalidateTeacherBoards(section.schoolId);
  invalidateStudentBoards(section.schoolId);
  return { marked: input.records.length };
}

async function sendAbsenteeAlerts(
  db: PrismaClient,
  schoolId: string,
  studentIds: string[],
  date: string,
): Promise<void> {
  let send: ReturnType<typeof mailer>;
  try {
    send = mailer();
  } catch (err) {
    if (err instanceof MailerUnconfiguredError) {
      console.warn("Skipping absentee alerts: SMTP not configured.");
      return;
    }
    throw err;
  }
  const school = await db.school.findUnique({ where: { id: schoolId } });
  const students = await db.student.findMany({
    where: { id: { in: studentIds } },
    select: {
      id: true,
      user: { select: { name: true } },
      guardianLinks: { select: { parent: { select: { name: true, email: true } } } },
    },
  });
  const deliveries = students.flatMap((student) =>
    student.guardianLinks.map((link) => ({
      to: link.parent.email,
      guardianName: link.parent.name,
      studentName: student.user.name,
      date,
      schoolName: school?.name ?? "your school",
    })),
  );
  const results = await Promise.allSettled(deliveries.map((alert) => send.sendAbsenteeAlert(alert)));
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Absentee alert delivery failed:", result.reason);
    }
  }
}

export interface StudentSummary {
  studentId: string;
  name: string;
  total: number;
  present: number;
  percent: number;
}

// Weights: a late arrival counts half. Excused counts as marked-but-absent
// (denominator = marked days, so excused days dilute the score honestly
// instead of vanishing — a school that wants excused-immune rates can
// filter the status upstream; the math stays auditable either way).
function statusWeight(status: string): number {
  if (status === "PRESENT") {
    return 1;
  }
  if (status === "LATE") {
    return 0.5;
  }
  return 0;
}

function monthBounds(month: string | undefined, from: string | undefined, to: string | undefined): { start: Date; end: Date } {
  if (from ?? to) {
    if (!from || !to) {
      throw new AuthError(400, "VALIDATION_ERROR", "Provide both from and to for a custom range.");
    }
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    if (start.getTime() > end.getTime()) {
      throw new AuthError(400, "VALIDATION_ERROR", "From must not be after to.");
    }
    return { start, end };
  }
  const base = month ?? new Date().toISOString().slice(0, 7);
  const [year, mon] = base.split("-").map(Number);
  if (!year || !mon || mon < 1 || mon > 12) {
    throw new AuthError(400, "VALIDATION_ERROR", "Month must be YYYY-MM.");
  }
  return {
    start: new Date(Date.UTC(year, mon - 1, 1)),
    end: new Date(Date.UTC(year, mon, 0)),
  };
}

// Monthly/term % per student (§10) via prefix sums (§11): rows come back
// date-ordered per student, one cumulative present-weight array is built,
// and any range % is then an O(1) difference of two prefix entries instead
// of a re-scan. At MVP scale the win is clarity, not speed — the shape is
// what matters, and it stays O(n) build + O(1) query as data grows.
//
// Self-scope contract (enforced by the ROUTE, which sees req.studentScope):
// pass allowedIds = scope pins for STUDENT/PARENT, or null for staff.
// An explicit studentId outside the pins is rejected here, never widened.
export async function attendanceSummary(
  db: PrismaClient,
  input: SummaryInput,
  allowedIds: string[] | null,
): Promise<{ range: { from: string; to: string }; summary: StudentSummary[] }> {
  if (input.studentId && allowedIds && !allowedIds.includes(input.studentId)) {
    throw new AuthError(403, "FORBIDDEN", "Not your record.");
  }

  const { start, end } = monthBounds(input.month, input.from, input.to);
  const studentIds: string | string[] | null = input.studentId ?? allowedIds;
  const rows = await db.attendance.findMany({
    where: {
      date: { gte: start, lte: end },
      ...(input.sectionId ? { sectionId: input.sectionId } : {}),
      ...(studentIds === null ? {} : { studentId: typeof studentIds === "string" ? studentIds : { in: studentIds } }),
    },
    select: { studentId: true, date: true, status: true, student: { select: { user: { select: { name: true } } } } },
    orderBy: [{ studentId: "asc" }, { date: "asc" }],
  });

  // Group (already ordered) then prefix-sum each student's weights.
  const byStudent = new Map<string, { name: string; weights: number[] }>();
  for (const row of rows) {
    const entry = byStudent.get(row.studentId) ?? { name: row.student.user.name, weights: [] };
    entry.weights.push(statusWeight(row.status));
    byStudent.set(row.studentId, entry);
  }

  const summary: StudentSummary[] = [];
  for (const [studentId, entry] of byStudent) {
    const prefix: number[] = [0];
    for (const w of entry.weights) {
      const last = prefix[prefix.length - 1] ?? 0;
      prefix.push(last + w);
    }
    const total = entry.weights.length;
    const present = prefix[prefix.length - 1] ?? 0;
    summary.push({
      studentId,
      name: entry.name,
      total,
      present,
      percent: total === 0 ? 0 : Math.round((present / total) * 1000) / 10,
    });
  }
  summary.sort((a, b) => a.name.localeCompare(b.name));

  return {
    range: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
    summary,
  };
}

// Daily roster hydration (marking-screen reopen): the saved statuses for
// one section+day. Same authorization as marking - a School Admin, or the
// section's assigned class teacher. This is the read side of the same
// daily workflow; without it a reopened day shows silent PRESENT defaults
// and a careless re-save would flip real absences to present.
export async function rosterAttendance(
  db: PrismaClient,
  caller: Caller,
  input: RosterInput,
): Promise<{ records: { studentId: string; status: string }[] }> {
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
        "Only the section's class teacher or a School Admin may read its attendance.",
      );
    }
  }
  const date = new Date(`${input.date}T00:00:00Z`);
  const rows = await db.attendance.findMany({
    where: { sectionId: section.id, date },
    select: { studentId: true, status: true },
  });
  return { records: rows.map((r) => ({ studentId: r.studentId, status: r.status })) };
}

export interface FlaggedPupil {
  studentId: string;
  name: string;
  anomalies: AttendanceAnomaly[];
}

// Anomaly scan (§7 Phase 3 #18): the DETECTION is the pure sliding-window
// function above — this service only fetches one section's trailing marked
// days, groups them per pupil, and runs the detector. Groq's sole input is
// the detected facts (counts + rates + dates, no pupil names); it phrases
// the summary, it never reasons about who is anomalous. Without a key the
// detections still return with summary null — the AI line enhances the
// scan, it is not the scan.
export async function attendanceAnomalies(
  db: PrismaClient,
  caller: Caller,
  input: AnomaliesInput,
): Promise<{
  section: { id: string; name: string };
  windowDays: number;
  range: { from: string; to: string } | null;
  checked: number;
  flagged: FlaggedPupil[];
  summary: string | null;
  summaryStatus: "ok" | "unconfigured" | "failed";
}> {
  const section = await db.section.findFirst({
    where: { id: input.sectionId },
    include: { class: { select: { name: true } } },
  });
  if (!section) {
    throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
  }
  if (caller.role !== "SCHOOL_ADMIN") {
    const staff = await db.staff.findFirst({ where: { userId: caller.userId } });
    if (!staff || section.classTeacherId !== staff.id) {
      throw new AuthError(
        403,
        "NOT_SECTION_TEACHER",
        "Only the section's class teacher or a School Admin may read its attendance.",
      );
    }
  }

  const recent = await db.attendance.findMany({
    where: { sectionId: section.id },
    select: { date: true },
    distinct: ["date"],
    orderBy: { date: "desc" },
    take: input.windowDays,
  });
  const dayStrings = recent.map((r) => r.date.toISOString().slice(0, 10)).sort();
  const pupils = await db.student.findMany({
    where: { sectionId: section.id },
    select: { id: true, user: { select: { name: true } } },
  });
  if (dayStrings.length === 0) {
    return {
      section: { id: section.id, name: `${section.class.name} · ${section.name}` },
      windowDays: input.windowDays,
      range: null,
      checked: pupils.length,
      flagged: [],
      summary: null,
      summaryStatus: "ok",
    };
  }
  const firstDay = dayStrings[0] ?? "";
  const lastDay = dayStrings[dayStrings.length - 1] ?? "";

  const rows = await db.attendance.findMany({
    where: { sectionId: section.id, date: { in: recent.map((r) => r.date) } },
    select: { studentId: true, date: true, status: true },
  });
  const byStudent = new Map<string, AnomalyDay[]>();
  for (const row of rows) {
    const list = byStudent.get(row.studentId) ?? [];
    list.push({ date: row.date.toISOString().slice(0, 10), status: row.status });
    byStudent.set(row.studentId, list);
  }

  const flagged: FlaggedPupil[] = [];
  for (const pupil of pupils) {
    const trail = (byStudent.get(pupil.id) ?? []).sort((a, b) => (a.date < b.date ? -1 : 1));
    const anomalies = detectAnomalies(trail, input.windowDays);
    if (anomalies.length > 0) {
      flagged.push({ studentId: pupil.id, name: pupil.user.name, anomalies });
    }
  }
  flagged.sort((a, b) => a.name.localeCompare(b.name));

  // One summary call for the whole section, built from de-identified
  // facts only — Groq never sees a pupil name here.
  let summary: string | null = null;
  let summaryStatus: "ok" | "unconfigured" | "failed" = "ok";
  if (flagged.length > 0) {
    const factLines = flagged.flatMap((p) => p.anomalies.map((a) => `- ${a.facts}`));
    try {
      summary = await groq().generateText({
        prompt: [
          `Section ${section.class.name} ${section.name} (${pupils.length} pupils checked, trailing ${dayStrings.length} marked days ${firstDay} to ${lastDay}):`,
          ...factLines,
          "Summarize these attendance patterns for a school administrator in two or three sentences. Refer to pupils only as 'this pupil' / 'these pupils', never by name.",
        ].join("\n"),
      });
    } catch (err) {
      if (err instanceof GroqUnconfiguredError) {
        summaryStatus = "unconfigured";
      } else if (err instanceof GroqApiError) {
        summaryStatus = "failed";
      } else {
        throw err;
      }
    }
  }

  return {
    section: { id: section.id, name: `${section.class.name} · ${section.name}` },
    windowDays: input.windowDays,
    range: { from: firstDay, to: lastDay },
    checked: pupils.length,
    flagged,
    summary,
    summaryStatus,
  };
}
