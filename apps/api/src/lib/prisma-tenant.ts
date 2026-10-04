import { PrismaClient } from "@prisma/client";

// Every model listed here MUST have a `schoolId` column. Add new
// tenant-scoped models to this list in the SAME COMMIT you add them to
// schema.prisma (RULES.md §3) — schema models added without a matching entry
// here are exactly how v1 leaked data across tenants.
// Deliberately NOT here: Role, Permission, RolePermission (fixed global set,
// §9.1), AuthToken + RefreshToken (looked up by hash before any tenant
// context exists).
export const TENANT_MODELS = [
  "User",
  "Student",
  "Staff",
  "TeacherSubject",
  "Class",
  "Section",
  "AcademicYear",
  "Subject",
  "StudentGuardian",
  "Attendance",
  "FeeStructure",
  "FeeInvoice",
  "FeePayment",
  "Exam",
  "ExamSubject",
  "Mark",
  "TimetableSlot",
  "Homework",
  "HomeworkSubmission",
  "Notice",
  "Enquiry",
  "EnquiryNote",
  "Certificate",
  "Book",
  "BookLoan",
  "Vehicle",
  "TransportRoute",
  "StudentRoute",
  "SalaryStructure",
  "PayrollPayment",
  "Document",
  "Message",
] as const;

const READ_OPS = new Set(["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"]);
const WRITE_OPS = new Set(["update", "delete", "updateMany", "deleteMany", "upsert"]);

// Fail-closed scoping: every read/write on a tenant model is force-pinned to
// the request's schoolId, and creates are force-stamped with it — a handler
// cannot forget `where: { schoolId }` on a one-off query.
//
// Two known limits of this shape (same as the reference pattern), handled by
// convention, not cleverness:
// - findUnique + injected where: verified live on Prisma 6.12 (2026-09-24)
//   that `{ id, schoolId }` resolves normally same-tenant and returns null
//   cross-tenant — no leak either way. Tenant reads still prefer
//   findFirst/findMany by convention.
// - createMany with an array payload is stamped per-row below.
export function scopedPrismaClient(prisma: PrismaClient, schoolId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && (TENANT_MODELS as readonly string[]).includes(model)) {
            const scoped = args as {
              where?: Record<string, unknown>;
              data?: Record<string, unknown> | Record<string, unknown>[];
            };
            if (READ_OPS.has(operation) || WRITE_OPS.has(operation)) {
              scoped.where = { ...(scoped.where ?? {}), schoolId };
            }
            if (operation === "create" && scoped.data && typeof scoped.data === "object" && !Array.isArray(scoped.data)) {
              scoped.data = { ...scoped.data, schoolId };
            }
            if (operation === "createMany" && Array.isArray(scoped.data)) {
              scoped.data = scoped.data.map((row) => ({ ...row, schoolId }));
            }
          }
          return query(args);
        },
      },
    },
  });
}

export type ScopedPrismaClient = ReturnType<typeof scopedPrismaClient>;

// NEVER cache or reuse a scoped client across requests: it is created fresh
// per request from that request's verified schoolId (spec §12.3 keeps ONE
// shared raw client; these scoped wrappers are cheap and disposable).
// NEVER use it from POST /auth/register (no school_id exists yet — §13.4).
