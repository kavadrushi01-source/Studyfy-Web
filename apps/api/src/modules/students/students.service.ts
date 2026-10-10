import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { recordAudit } from "../../lib/audit.js";
import { AuthError } from "../auth/auth.service.js";
import { invalidateStudentKpis } from "../metrics/metrics.service.js";
import type { AdmitStudentInput } from "./students.schemas.js";

const BCRYPT_COST = 12;

export interface AdmittedGuardian {
  user: { id: string; email: string; name: string };
  // Present only when the account was JUST created. Reused (sibling)
  // accounts keep their existing password — never reset, never returned.
  tempPassword: string | null;
}

export interface AdmissionResult {
  student: {
    id: string;
    admissionNo: string | null;
    rollNumber: number | null;
    user: { id: string; email: string; name: string };
  };
  // One-time only: the admin hands it to the family. Never stored, never
  // logged, never returned again — same rule as §13.3 (per-account random,
  // never a shared default).
  studentTempPassword: string;
  guardians: AdmittedGuardian[];
}

function tempPassword(): string {
  return randomBytes(9).toString("base64url");
}

// Admission (SIS §7 Phase 1 #1): creates the students row AND the linked
// users row for the student's own login, plus guardian accounts + links.
// Runs on the tenant-SCOPED client, so the section lookup alone enforces
// "this section belongs to this school" — a foreign sectionId 404s.
// Audit (§13.10 USER_CREATE): one row per FRESH user (student + new
// guardians; reused sibling accounts create no user, so no row). Sequential
// same-client writes right after each create — this looped multi-entity
// flow can't join a single array transaction without restructuring its
// reads (every audit row is asserted by test instead).
export async function admitStudent(
  db: PrismaClient,
  input: AdmitStudentInput,
  actorId: string,
): Promise<AdmissionResult> {
  const [studentRole, parentRole] = await Promise.all([
    db.role.findUnique({ where: { name: "STUDENT" } }),
    db.role.findUnique({ where: { name: "PARENT" } }),
  ]);
  if (!studentRole || !parentRole) {
    throw new AuthError(500, "ROLES_NOT_SEEDED", "Roles are not seeded. Run the db seed script first.");
  }

  const section = await db.section.findFirst({ where: { id: input.sectionId } });
  if (!section) {
    throw new AuthError(404, "SECTION_NOT_FOUND", "Section not found in this school.");
  }

  const schoolId = section.schoolId;
  const existing = await db.user.findUnique({
    where: { schoolId_email: { schoolId, email: input.email } },
  });
  if (existing) {
    throw new AuthError(409, "EMAIL_TAKEN", "An account with this email already exists in this school.");
  }

  const studentTempPassword = tempPassword();
  const studentUser = await db.user.create({
    data: {
      schoolId,
      roleId: studentRole.id,
      email: input.email,
      passwordHash: await bcrypt.hash(studentTempPassword, BCRYPT_COST),
      name: input.name,
    },
  });
  // entityId is the email (stable, known upfront); the allowlist keeps
  // hashes out — after carries role + active flag only.
  await recordAudit(db, {
    schoolId,
    actorId,
    action: "USER_CREATE",
    entity: "User",
    entityId: input.email,
    after: { role: "STUDENT", isActive: true },
  });
  const student = await db.student.create({
    data: {
      schoolId,
      userId: studentUser.id,
      sectionId: section.id,
      // Auto-number when the office leaves it blank: the roster column must
      // never show a blank for a real admission. Explicit numbers pass
      // through untouched.
      admissionNo:
        input.admissionNo ??
        `ADM-${new Date().getUTCFullYear()}-${randomBytes(2).toString("hex").toUpperCase()}`,
      rollNumber: input.rollNumber,
      dob: input.dob ? new Date(`${input.dob}T00:00:00Z`) : undefined,
      gender: input.gender,
    },
  });

  const guardians: AdmittedGuardian[] = [];
  for (const guardian of input.guardians ?? []) {
    const reused = await db.user.findUnique({
      where: { schoolId_email: { schoolId, email: guardian.email } },
    });
    if (reused) {
      const link = await db.studentGuardian.findUnique({
        where: { studentId_parentId: { studentId: student.id, parentId: reused.id } },
      });
      if (!link) {
        await db.studentGuardian.create({
          data: { schoolId, studentId: student.id, parentId: reused.id, relationship: guardian.relationship },
        });
      }
      guardians.push({
        user: { id: reused.id, email: reused.email, name: reused.name },
        tempPassword: null,
      });
      continue;
    }
    const fresh = tempPassword();
    const created = await db.user.create({
      data: {
        schoolId,
        roleId: parentRole.id,
        email: guardian.email,
        passwordHash: await bcrypt.hash(fresh, BCRYPT_COST),
        name: guardian.name,
      },
    });
    await recordAudit(db, {
      schoolId,
      actorId,
      action: "USER_CREATE",
      entity: "User",
      entityId: guardian.email,
      after: { role: "PARENT", isActive: true },
    });
    await db.studentGuardian.create({
      data: { schoolId, studentId: student.id, parentId: created.id, relationship: guardian.relationship },
    });
    guardians.push({
      user: { id: created.id, email: created.email, name: created.name },
      tempPassword: fresh,
    });
  }

  // Roster changed → the cached student count for this school is stale
  // (§12.3 invalidate on write).
  invalidateStudentKpis(schoolId);

  return {
    student: {
      id: student.id,
      admissionNo: student.admissionNo,
      rollNumber: student.rollNumber,
      user: { id: studentUser.id, email: studentUser.email, name: studentUser.name },
    },
    studentTempPassword,
    guardians,
  };
}
