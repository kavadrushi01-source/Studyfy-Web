import type { PrismaClient } from "@prisma/client";
import { pickAuditFields, recordAudit } from "../../lib/audit.js";
import { MailerUnconfiguredError, mailerFor } from "../../lib/mailer.js";
// RAW client, deliberately: Platform Owners have schoolId = NULL, and the
// tenant extension force-pins every User read to the request's school
// (scopedPrismaClient) — the owners query would match 0 rows on the
// scoped client. Same reasoning as AuditLog's NULL note in prisma-tenant.
import { prisma as rawPrisma } from "../../lib/prisma.js";
import { AuthError } from "../auth/auth.service.js";
import type { CreateTicketInput, ListTicketsInput, OwnerMessageInput } from "./support.schemas.js";

// Ticket notifications (§7 #27): the Platform Owner learns about new
// threads; the thread creator learns about replies (never the author
// themselves — no self-mail). Best-effort like every mail path: a send
// failure logs and the request still succeeds (the thread row is the
// source of truth, not the inbox). Demo-suppressed via the ticket's
// school — the single mailerFor choke point, no second guard to diverge.
async function ticketSchoolCtx(db: PrismaClient, schoolId: string): Promise<{ isDemo: boolean; slug: string; name: string } | null> {
  return db.school.findUnique({ where: { id: schoolId }, select: { isDemo: true, slug: true, name: true } });
}

async function notifyOwnersTicketOpened(
  school: { isDemo: boolean; slug: string; name: string },
  subject: string,
  priority: string,
): Promise<void> {
  const owners = await rawPrisma.user.findMany({
    where: { schoolId: null, isActive: true, role: { name: "PLATFORM_OWNER" } },
    select: { email: true, name: true },
  });
  if (owners.length === 0) {
    return;
  }
  for (const owner of owners) {
    try {
      await mailerFor({ isDemo: school.isDemo, slug: school.slug }).sendTicketOpened({ to: owner.email, name: owner.name, schoolName: school.name, subject, priority });
    } catch (err) {
      // Unconfigured SMTP is expected locally — same guard as password
      // reset and fee reminders (they log-only for real failures). It
      // throws for EVERY owner, so stop the loop rather than 1000×.
      if (err instanceof MailerUnconfiguredError) {
        return;
      }
      console.error("Ticket-opened email delivery failed:", err);
    }
  }
}

async function notifyCreatorTicketReply(
  db: PrismaClient,
  school: { isDemo: boolean; slug: string; name: string },
  ticketId: string,
  excludeUserId: string,
  subject: string,
  body: string,
): Promise<void> {
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { createdById: true } });
  if (!ticket || ticket.createdById === excludeUserId) {
    return;
  }
  const creator = await db.user.findUnique({ where: { id: ticket.createdById }, select: { id: true, email: true, name: true, isActive: true } });
  if (!creator || !creator.isActive) {
    return;
  }
  try {
    await mailerFor({ isDemo: school.isDemo, slug: school.slug }).sendTicketReply({
      to: creator.email,
      name: creator.name,
      schoolName: school.name,
      subject,
      body,
    });
  } catch (err) {
    if (!(err instanceof MailerUnconfiguredError)) {
      console.error("Ticket-reply email delivery failed:", err);
    }
  }
}

// Uploaded screenshot, already stored (§13.5 whitelist checked at the
// route; the bytes live in Cloudinary before this runs — external side
// effects can't join the DB transaction, same as certificate uploads).
export interface TicketAttachmentUpload {
  url: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
}

// §13.5 file whitelist for ticket screenshots: images + PDF, 5 MB — the
// same rule as admission documents (MIME *and* extension must agree; both
// are client-controlled. No content sniffing, same noted hardening gap).
const ATTACHMENT_MIMES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export function validateAttachmentFile(file: { mimetype: string; originalname: string; size: number }): void {
  const dot = file.originalname.lastIndexOf(".");
  const ext = dot >= 0 ? file.originalname.slice(dot).toLowerCase() : "";
  const allowed = ATTACHMENT_MIMES[file.mimetype];
  if (!allowed || !allowed.includes(ext)) {
    throw new AuthError(415, "UNSUPPORTED_FILE_TYPE", "Only JPEG, PNG, WebP images and PDF files are accepted.");
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    throw new AuthError(413, "FILE_TOO_LARGE", "Attachments must be 5 MB or smaller.");
  }
}

// In-app support tickets (§7 Phase 4 #27): schools open threads to the
// platform; the Platform Owner works them (replies, internal notes,
// status). The isInternal boundary is enforced IN THE QUERIES below —
// school-facing reads filter `isInternal: false` at the database, so a UI
// bug can never leak an internal note (proved both directions by test).
// Writes that change two rows (message + status) share one interactive
// transaction with their audit rows. schoolId is passed explicitly into
// every create: owner paths run on the RAW client (platformOnlyMiddleware),
// where the tenant extension stamps nothing.

export async function createTicket(
  db: PrismaClient,
  schoolId: string,
  authorId: string,
  input: CreateTicketInput,
): Promise<{ id: string; status: string }> {
  const author = await db.user.findFirst({ where: { id: authorId, schoolId } });
  if (!author) {
    throw new AuthError(403, "FORBIDDEN", "Only this school's staff may open tickets.");
  }
  const created = await db.$transaction(async (tx) => {
    const ticket = await tx.ticket.create({
      data: { schoolId, createdById: authorId, subject: input.subject, priority: input.priority },
    });
    const txClient = tx as unknown as PrismaClient;
    await recordAudit(txClient, {
      schoolId,
      actorId: authorId,
      action: "TICKET_CREATED",
      entity: "Ticket",
      entityId: ticket.id,
      after: pickAuditFields("Ticket", { id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority }),
    });
    return ticket;
  });
  const school = await ticketSchoolCtx(db, schoolId);
  if (school) {
    await notifyOwnersTicketOpened(school, created.subject, created.priority);
  }
  return { id: created.id, status: created.status };
}

export interface TicketRequester {
  userId: string;
  // School Admins see every thread of their school; staff see only threads
  // they opened (createdBy). Students/parents hold no support key at all.
  isAdmin: boolean;
}

export async function listTickets(
  db: PrismaClient,
  schoolId: string,
  input: ListTicketsInput,
  requester: TicketRequester,
) {
  return db.ticket.findMany({
    where: {
      schoolId,
      ...(input.status ? { status: input.status } : {}),
      ...(requester.isAdmin ? {} : { createdById: requester.userId }),
    },
    orderBy: { createdAt: "desc" },
    take: input.take,
    select: {
      id: true,
      subject: true,
      status: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
      // Filtered count: internal notes must not leak even their EXISTENCE
      // to the school (a count of hidden notes is still information).
      _count: { select: { messages: { where: { isInternal: false } } } },
    },
  });
}

export async function getTicketDetail(
  db: PrismaClient,
  schoolId: string,
  ticketId: string,
  opts: { includeInternal: boolean; requester?: TicketRequester },
) {
  const ticket = await db.ticket.findFirst({
    // Non-admins must own the thread: same 404 as a foreign id, so staff
    // can never probe whether another thread exists.
    where: {
      id: ticketId,
      schoolId,
      ...(opts.requester && !opts.requester.isAdmin ? { createdById: opts.requester.userId } : {}),
    },
    select: {
      id: true,
      schoolId: true,
      subject: true,
      status: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        where: opts.includeInternal ? {} : { isInternal: false },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          authorId: true,
          body: true,
          isInternal: true,
          createdAt: true,
          attachments: { select: { id: true, url: true, mimeType: true, sizeBytes: true, originalName: true } },
        },
      },
    },
  });
  if (!ticket) {
    throw new AuthError(404, "TICKET_NOT_FOUND", "Support ticket not found in this school.");
  }
  return ticket;
}

export async function postSchoolMessage(
  db: PrismaClient,
  schoolId: string,
  ticketId: string,
  authorId: string,
  body: string,
  attachment?: TicketAttachmentUpload,
  requester?: TicketRequester,
): Promise<{ id: string }> {
  const ticket = await db.ticket.findFirst({
    where: {
      id: ticketId,
      schoolId,
      ...(requester && !requester.isAdmin ? { createdById: requester.userId } : {}),
    },
  });
  if (!ticket) {
    throw new AuthError(404, "TICKET_NOT_FOUND", "Support ticket not found in this school.");
  }
  const author = await db.user.findFirst({ where: { id: authorId, schoolId } });
  if (!author) {
    throw new AuthError(403, "FORBIDDEN", "Only this school's staff may reply to tickets.");
  }
  const created = await db.$transaction(async (tx) => {
    const message = await tx.ticketMessage.create({
      data: { schoolId, ticketId: ticket.id, authorId, body, isInternal: false },
    });
    if (attachment) {
      await tx.ticketAttachment.create({
        data: {
          schoolId,
          ticketId: ticket.id,
          messageId: message.id,
          url: attachment.url,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          originalName: attachment.originalName,
        },
      });
    }
    const txClient = tx as unknown as PrismaClient;
    await recordAudit(txClient, {
      schoolId,
      actorId: authorId,
      action: "TICKET_MESSAGE",
      entity: "TicketMessage",
      entityId: message.id,
      after: pickAuditFields("TicketMessage", { id: message.id, isInternal: message.isInternal }),
    });
    return message;
  });
  const school = await ticketSchoolCtx(db, schoolId);
  if (school) {
    await notifyCreatorTicketReply(db, school, ticket.id, authorId, ticket.subject, body);
  }
  return { id: created.id };
}

export async function ownerPostMessage(
  db: PrismaClient,
  ticketId: string,
  authorId: string,
  input: OwnerMessageInput,
  attachment?: TicketAttachmentUpload,
): Promise<{ id: string; status: string }> {
  const ticket = await db.ticket.findFirst({ where: { id: ticketId } });
  if (!ticket) {
    throw new AuthError(404, "TICKET_NOT_FOUND", "Support ticket not found.");
  }
  const result = await db.$transaction(async (tx) => {
    const message = await tx.ticketMessage.create({
      data: { schoolId: ticket.schoolId, ticketId: ticket.id, authorId, body: input.body, isInternal: input.isInternal },
    });
    if (attachment) {
      await tx.ticketAttachment.create({
        data: {
          schoolId: ticket.schoolId,
          ticketId: ticket.id,
          messageId: message.id,
          url: attachment.url,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          originalName: attachment.originalName,
        },
      });
    }
    const txClient = tx as unknown as PrismaClient;
    await recordAudit(txClient, {
      schoolId: ticket.schoolId,
      actorId: authorId,
      action: "TICKET_MESSAGE",
      entity: "TicketMessage",
      entityId: message.id,
      after: pickAuditFields("TicketMessage", { id: message.id, isInternal: message.isInternal }),
    });
    let status = ticket.status;
    if (input.status && input.status !== ticket.status) {
      const updated = await tx.ticket.update({ where: { id: ticket.id }, data: { status: input.status } });
      status = updated.status;
      await recordAudit(txClient, {
        schoolId: ticket.schoolId,
        actorId: authorId,
        action: "TICKET_STATUS_CHANGE",
        entity: "Ticket",
        entityId: ticket.id,
        before: pickAuditFields("Ticket", { id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority }),
        after: pickAuditFields("Ticket", { id: ticket.id, subject: ticket.subject, status: updated.status, priority: ticket.priority }),
      });
    }
    return { id: message.id, status };
  });
  // Internal notes are owner-only — emailing them to the creator would
  // leak the note itself. Only PUBLIC replies notify the thread creator.
  if (!input.isInternal) {
    const school = await ticketSchoolCtx(db, ticket.schoolId);
    if (school) {
      await notifyCreatorTicketReply(db, school, ticket.id, authorId, ticket.subject, input.body);
    }
  }
  return result;
}
