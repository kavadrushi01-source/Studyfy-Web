import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import type { CreateStructureInput } from "./fees.schemas.js";

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
