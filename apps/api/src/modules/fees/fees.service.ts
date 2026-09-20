import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import type { CreateStructureInput, GenerateInvoicesInput } from "./fees.schemas.js";

// Fee structure per class (§7 Phase 1 #3): amount + term + category. Runs
// on the tenant-SCOPED client, so the class lookup alone proves "this
// class belongs to this school" — a foreign classId 404s instead of
// attaching a structure to another tenant's class.
export async function createStructure(db: PrismaClient, input: CreateStructureInput) {
  const cls = await db.class.findFirst({ where: { id: input.classId } });
  if (!cls) {
    throw new AuthError(404, "CLASS_NOT_FOUND", "Class not found in this school.");
  }
  if (input.academicYearId) {
    const year = await db.academicYear.findFirst({ where: { id: input.academicYearId } });
    if (!year) {
      throw new AuthError(404, "ACADEMIC_YEAR_NOT_FOUND", "Academic year not found in this school.");
    }
  }
  try {
    return await db.feeStructure.create({
      data: {
        schoolId: cls.schoolId,
        classId: cls.id,
        academicYearId: input.academicYearId,
        name: input.name,
        // String in, Decimal out — the ONLY arithmetic-safe path (§13.6).
        amount: new Prisma.Decimal(input.amount),
        term: input.term,
        category: input.category,
        description: input.description,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AuthError(409, "STRUCTURE_EXISTS", "A structure with this name already exists for the class.");
    }
    throw err;
  }
}

export interface GenerateInvoicesResult {
  generated: number;
  skipped: { studentId: string; reason: string }[];
}

// Bulk-generate invoices from a structure (§7 Phase 1 #3): one invoice per
// student, for the structure's exact amount, PENDING by default. One action
// covers a whole class — never one click per student.
//
// Idempotency ("one invoice per student per term"): a student who already
// holds a live invoice (anything but REFUNDED) for this structure is
// SKIPPED, never double-billed — so re-running the action after admitting
// late joiners only invoices the newcomers. The response says who was
// skipped and why.
export async function generateInvoices(
  db: PrismaClient,
  input: GenerateInvoicesInput,
): Promise<GenerateInvoicesResult> {
  const structure = await db.feeStructure.findFirst({ where: { id: input.structureId } });
  if (!structure) {
    throw new AuthError(404, "STRUCTURE_NOT_FOUND", "Fee structure not found in this school.");
  }

  let studentIds: string[];
  if (input.classId) {
    const cls = await db.class.findFirst({ where: { id: input.classId } });
    if (!cls) {
      throw new AuthError(404, "CLASS_NOT_FOUND", "Class not found in this school.");
    }
    const students = await db.student.findMany({
      where: { section: { classId: cls.id } },
      select: { id: true },
    });
    studentIds = students.map((s) => s.id);
  } else if (input.sectionId) {
    const section = await db.section.findFirst({ where: { id: input.sectionId } });
    if (!section) {
      throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
    }
    const students = await db.student.findMany({ where: { sectionId: section.id }, select: { id: true } });
    studentIds = students.map((s) => s.id);
  } else {
    const students = await db.student.findMany({
      where: { id: { in: input.studentIds ?? [] } },
      select: { id: true },
    });
    const found = new Set(students.map((s) => s.id));
    const missing = (input.studentIds ?? []).filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new AuthError(404, "STUDENT_NOT_FOUND", "One or more students were not found in this school.");
    }
    studentIds = students.map((s) => s.id);
  }

  // Every scoped lookup above already confines to this tenant: foreign ids
  // 404 instead of generating cross-tenant invoices.
  const existing = await db.feeInvoice.findMany({
    where: {
      structureId: structure.id,
      studentId: { in: studentIds },
      status: { not: "REFUNDED" },
    },
    select: { studentId: true, status: true },
  });
  const alreadyBilled = new Map(existing.map((e) => [e.studentId, e.status]));
  const skipped: { studentId: string; reason: string }[] = [];
  const fresh: string[] = [];
  for (const studentId of studentIds) {
    const status = alreadyBilled.get(studentId);
    if (status) {
      skipped.push({ studentId, reason: `Already has a ${status} invoice for this structure.` });
    } else {
      fresh.push(studentId);
    }
  }

  const dueDate = new Date(`${input.dueDate}T00:00:00Z`);
  await db.$transaction(
    fresh.map((studentId) =>
      db.feeInvoice.create({
        data: {
          schoolId: structure.schoolId,
          studentId,
          structureId: structure.id,
          amount: structure.amount,
          amountPaid: 0,
          status: "PENDING",
          dueDate,
        },
      }),
    ),
  );
  return { generated: fresh.length, skipped };
}
