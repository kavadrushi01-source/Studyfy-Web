import type { PrismaClient } from "@prisma/client";
import { pickAuditFields, recordAudit } from "../../lib/audit.js";
import { AuthError } from "../auth/auth.service.js";
import type { CreateTicketInput, ListTicketsInput, OwnerMessageInput } from "./support.schemas.js";

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
  return { id: created.id, status: created.status };
}

export async function listTickets(db: PrismaClient, schoolId: string, input: ListTicketsInput) {
  return db.ticket.findMany({
    where: { schoolId, ...(input.status ? { status: input.status } : {}) },
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
  opts: { includeInternal: boolean },
) {
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, schoolId },
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
): Promise<{ id: string }> {
  const ticket = await db.ticket.findFirst({ where: { id: ticketId, schoolId } });
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
  return result;
}
