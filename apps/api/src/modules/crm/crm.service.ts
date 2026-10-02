import type { PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import type { ListEnquiriesInput, UpdateEnquiryInput } from "./crm.schemas.js";

// Admission pipeline (§7 Phase 2 #16): the public form drops rows in as
// NEW; office staff work them NEW → CONTACTED → VISITED → ADMITTED (or
// REJECTED) with an assignee and a follow-up timeline. Reads are office
// only (crm.read); writes need crm.manage. Cross-tenant safety comes
// from tenantMiddleware + the TENANT_MODELS entry, proven by the
// stranger-school test in the suite.
export async function listEnquiries(
  db: PrismaClient,
  input: ListEnquiriesInput,
): Promise<{
  enquiries: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    message: string;
    status: string;
    assignee: { id: string; name: string } | null;
    notesCount: number;
    createdAt: Date;
    updatedAt: Date;
  }[];
  totals: Record<string, number>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}> {
  const where: Record<string, unknown> = {};
  if (input.status) {
    where.status = input.status;
  }
  if (input.search) {
    const q = input.search;
    where.OR = [
      { name: { contains: q } },
      { phone: { contains: q } },
      { email: { contains: q } },
    ];
  }
  const [total, rows, grouped] = await Promise.all([
    db.enquiry.count({ where }),
    db.enquiry.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        message: true,
        status: true,
        assignee: { select: { id: true, name: true } },
        _count: { select: { notes: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.enquiry.groupBy({ by: ["status"], _count: { status: true } }),
  ]);
  const totals: Record<string, number> = {};
  for (const g of grouped) {
    totals[g.status] = g._count.status;
  }
  return {
    enquiries: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      message: r.message,
      status: r.status,
      assignee: r.assignee,
      notesCount: r._count.notes,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    totals,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export async function enquiryDetail(db: PrismaClient, enquiryId: string) {
  const row = await db.enquiry.findFirst({
    where: { id: enquiryId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      message: true,
      status: true,
      assignee: { select: { id: true, name: true } },
      notes: {
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!row) {
    throw new AuthError(404, "ENQUIRY_NOT_FOUND", "Enquiry not found in this school.");
  }
  return { enquiry: row };
}

export async function updateEnquiry(
  db: PrismaClient,
  caller: { userId: string; name: string },
  enquiryId: string,
  input: UpdateEnquiryInput,
) {
  const row = await db.enquiry.findFirst({ where: { id: enquiryId } });
  if (!row) {
    throw new AuthError(404, "ENQUIRY_NOT_FOUND", "Enquiry not found in this school.");
  }
  let assigneeId: string | null | undefined;
  if (input.assigneeId !== undefined) {
    if (input.assigneeId === null) {
      assigneeId = null;
    } else {
      const staffer = await db.user.findFirst({
        where: { id: input.assigneeId },
        select: { id: true, role: { select: { name: true } } },
      });
      if (!staffer || (staffer.role.name !== "SCHOOL_ADMIN" && staffer.role.name !== "ACCOUNTANT" && staffer.role.name !== "TEACHER")) {
        throw new AuthError(404, "ASSIGNEE_NOT_FOUND", "Assignee must be a staff member of this school.");
      }
      assigneeId = staffer.id;
    }
  }
  const updated = await db.enquiry.update({
    where: { id: row.id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(assigneeId !== undefined ? { assigneeId } : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      message: true,
      status: true,
      assignee: { select: { id: true, name: true } },
      createdAt: true,
      updatedAt: true,
    },
  });
  // Status moves are recorded into the timeline automatically, so the
  // history reads complete even when nobody typed a note for the move.
  if (input.status !== undefined && input.status !== row.status) {
    await db.enquiryNote.create({
      data: {
        schoolId: row.schoolId,
        enquiryId: row.id,
        authorId: caller.userId,
        body: `${caller.name} moved this enquiry from ${row.status} to ${input.status}.`,
      },
    });
  }
  return { enquiry: updated };
}

export async function addEnquiryNote(
  db: PrismaClient,
  callerUserId: string,
  enquiryId: string,
  body: string,
) {
  const row = await db.enquiry.findFirst({ where: { id: enquiryId }, select: { id: true, schoolId: true } });
  if (!row) {
    throw new AuthError(404, "ENQUIRY_NOT_FOUND", "Enquiry not found in this school.");
  }
  const note = await db.enquiryNote.create({
    data: { schoolId: row.schoolId, enquiryId: row.id, authorId: callerUserId, body },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
  });
  return { note };
}
