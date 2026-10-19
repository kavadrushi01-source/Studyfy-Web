import type { PrismaClient } from "@prisma/client";
import { mailerFor, MailerUnconfiguredError } from "../../lib/mailer.js";
import { AuthError } from "../auth/auth.service.js";
import { invalidateActivityFeed, invalidateStudentBoards, invalidateTeacherBoards } from "../metrics/metrics.service.js";
import type { CreateNoticeInput, UpdateNoticeInput } from "./notices.schemas.js";

// Correct a published notice (ADMIN/TEACHER, notices.write). The board had
// POST and GET only, so a typo in a school-wide notice could never be fixed -
// it stayed visible to every student and parent forever. Editing re-targets
// the notice in place and does NOT re-send email: the correction is for the
// board, and re-mailing an already-delivered notice to the whole staff list
// on every keystroke-save is worse than staying quiet.
export async function updateNotice(
  db: PrismaClient,
  noticeId: string,
  input: UpdateNoticeInput,
): Promise<{ id: string; title: string }> {
  const existing = await db.notice.findFirst({
    where: { id: noticeId },
    select: { id: true, title: true, target: true, classId: true, sectionId: true, schoolId: true },
  });
  if (!existing) {
    throw new AuthError(404, "NOTICE_NOT_FOUND", "Notice not found in this school.");
  }
  const target = input.target ?? existing.target;
  const classId = input.classId ?? existing.classId;
  const sectionId = input.sectionId ?? existing.sectionId;
  // A retarget that names a foreign class/section must 404, not link across
  // tenants - the same rule publishNotice relies on.
  if (target === "CLASS" && classId) {
    const cls = await db.class.findFirst({ where: { id: classId } });
    if (!cls) {
      throw new AuthError(404, "CLASS_NOT_FOUND", "Class not found in this school.");
    }
  }
  if (target === "SECTION" && sectionId) {
    const sec = await db.section.findFirst({ where: { id: sectionId } });
    if (!sec) {
      throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
    }
  }
  const updated = await db.notice.update({
    where: { id: existing.id },
    data: {
      title: input.title ?? existing.title,
      body: input.body ?? undefined,
      target,
      classId: target === "CLASS" ? classId : null,
      sectionId: target === "SECTION" ? sectionId : null,
    },
    select: { id: true, title: true },
  });
  invalidateActivityFeed(existing.schoolId);
  invalidateTeacherBoards(existing.schoolId);
  invalidateStudentBoards(existing.schoolId);
  return updated;
}

// Withdraw a notice (ADMIN/TEACHER, notices.write). Needed for the same
// reason as updateNotice: a notice published to the wrong audience, or one
// that turns out to be wrong, previously could not be taken down at all.
export async function deleteNotice(db: PrismaClient, noticeId: string): Promise<{ deleted: string; title: string }> {
  const notice = await db.notice.findFirst({ where: { id: noticeId }, select: { id: true, title: true, schoolId: true } });
  if (!notice) {
    throw new AuthError(404, "NOTICE_NOT_FOUND", "Notice not found in this school.");
  }
  await db.notice.delete({ where: { id: notice.id } });
  invalidateActivityFeed(notice.schoolId);
  invalidateTeacherBoards(notice.schoolId);
  invalidateStudentBoards(notice.schoolId);
  return { deleted: notice.id, title: notice.title };
}

// Notice board (§7 Phase 1 #7): school-wide, class-wide, or section-scoped,
// with email delivery to affected parents/staff over the real SMTP channel
// (same mailer as absentee alerts — Brevo, free). Delivery is best-effort:
// a dead relay never fails the publish; failures are logged.
export async function publishNotice(
  db: PrismaClient,
  authorId: string,
  input: CreateNoticeInput,
): Promise<{ id: string; emailed: number }> {
  const schoolId = await resolveSchool(db, authorId, input);
  const notice = await db.notice.create({
    data: {
      schoolId,
      title: input.title,
      body: input.body,
      target: input.target,
      classId: input.target === "CLASS" ? input.classId : null,
      sectionId: input.target === "SECTION" ? input.sectionId : null,
      createdById: authorId,
    },
  });
  const emailed = await deliverNotice(db, notice.id).catch((err: unknown) => {
    console.error("Notice email delivery failed:", err);
    return 0;
  });
  // New notice → the activities feed is stale (§12.3).
  invalidateActivityFeed(schoolId);
  invalidateTeacherBoards(schoolId);
  invalidateStudentBoards(schoolId);
  return { id: notice.id, emailed };
}

// Scope validation runs on the TENANT-scoped client, so foreign class/
// section ids 404 instead of linking across tenants. Returns the notice's
// school: explicit for CLASS/SECTION, the author's own school for SCHOOL.
async function resolveSchool(db: PrismaClient, authorId: string, input: CreateNoticeInput): Promise<string> {
  if (input.target === "CLASS") {
    const cls = await db.class.findFirst({ where: { id: input.classId } });
    if (!cls) {
      throw new AuthError(404, "CLASS_NOT_FOUND", "Class not found in this school.");
    }
    return cls.schoolId;
  }
  if (input.target === "SECTION") {
    const section = await db.section.findFirst({ where: { id: input.sectionId } });
    if (!section) {
      throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
    }
    return section.schoolId;
  }
  const author = await db.user.findUnique({ where: { id: authorId } });
  if (!author?.schoolId) {
    throw new AuthError(400, "VALIDATION_ERROR", "School-wide notices need a school account as author.");
  }
  return author.schoolId;
}

async function deliverNotice(db: PrismaClient, noticeId: string): Promise<number> {
  const notice = await db.notice.findUnique({
    where: { id: noticeId },
    include: { school: { select: { name: true, slug: true, isDemo: true } } },
  });
  if (!notice) {
    return 0;
  }
  // Single choke point (§13.11): the demo guard lives in mailerFor().
  let send: ReturnType<typeof mailerFor>;
  try {
    send = mailerFor({ isDemo: notice.school.isDemo, slug: notice.school.slug });
  } catch (err) {
    if (err instanceof MailerUnconfiguredError) {
      console.warn("Skipping notice emails: SMTP not configured.");
      return 0;
    }
    throw err;
  }
  // Affected audience: school-wide = every parent + staffer; class/section
  // = parents of its students + all teachers (teachers span sections).
  let recipientIds: string[] | null = null;
  if (notice.target !== "SCHOOL") {
    const students = await db.student.findMany({
      where:
        notice.target === "CLASS"
          ? { section: { classId: notice.classId ?? "" } }
          : { sectionId: notice.sectionId ?? "" },
      select: { id: true },
    });
    const links = await db.studentGuardian.findMany({
      where: { studentId: { in: students.map((s) => s.id) } },
      select: { parentId: true },
    });
    const teachers = await db.user.findMany({
      where: { role: { name: "TEACHER" } },
      select: { id: true },
    });
    recipientIds = [...new Set([...links.map((l) => l.parentId), ...teachers.map((t) => t.id)])];
  }
  const recipients = await db.user.findMany({
    where: recipientIds
      ? { id: { in: recipientIds } }
      : { role: { name: { in: ["PARENT", "TEACHER", "ACCOUNTANT", "SCHOOL_ADMIN"] } } },
    select: { name: true, email: true },
  });
  const results = await Promise.allSettled(
    recipients.map((r) =>
      send.sendNoticeEmail({
        to: r.email,
        name: r.name,
        title: notice.title,
        body: notice.body,
        schoolName: notice.school.name,
      }),
    ),
  );
  let emailed = 0;
  for (const result of results) {
    // Only real sends count — demo-suppressed emails resolve fulfilled but
    // must never inflate the tally (§13.11).
    if (result.status === "fulfilled" && result.value === "sent") {
      emailed += 1;
    } else if (result.status === "rejected") {
      console.error("Notice email delivery failed:", result.reason);
    }
  }
  return emailed;
}
