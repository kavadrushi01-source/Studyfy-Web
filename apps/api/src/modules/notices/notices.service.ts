import type { PrismaClient } from "@prisma/client";
import { mailer, MailerUnconfiguredError } from "../../lib/mailer.js";
import { AuthError } from "../auth/auth.service.js";
import type { CreateNoticeInput } from "./notices.schemas.js";

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
  let send: ReturnType<typeof mailer>;
  try {
    send = mailer();
  } catch (err) {
    if (err instanceof MailerUnconfiguredError) {
      console.warn("Skipping notice emails: SMTP not configured.");
      return 0;
    }
    throw err;
  }
  const notice = await db.notice.findUnique({
    where: { id: noticeId },
    include: { school: { select: { name: true } } },
  });
  if (!notice) {
    return 0;
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
    if (result.status === "fulfilled") {
      emailed += 1;
    } else {
      console.error("Notice email delivery failed:", result.reason);
    }
  }
  return emailed;
}
