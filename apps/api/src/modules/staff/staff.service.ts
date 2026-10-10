import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { recordAudit } from "../../lib/audit.js";
import { AuthError } from "../auth/auth.service.js";
import { invalidateStaffCounts, invalidateTeacherBoards } from "../metrics/metrics.service.js";
import type { InviteStaffInput } from "./staff.schemas.js";

const BCRYPT_COST = 12;

function tempPassword(): string {
  return randomBytes(9).toString("base64url");
}

export interface InvitedStaff {
  staff: { id: string; designation: string; user: { id: string; email: string; name: string } };
  tempPassword: string;
}

// Staff invite: creates the login user (STAFF-role only) + staff row in
// one action. Runs on the tenant-SCOPED client. Duplicate email in this
// school is 409, mirroring admission. The temp password is returned once,
// like admission (§13.3 — per-account random, never shared).
// Audit (§13.10 USER_CREATE) rides INSIDE the same interactive transaction
// as both creates — the row and its log commit together or not at all.
export async function inviteStaffMember(
  db: PrismaClient,
  schoolId: string,
  input: InviteStaffInput,
  actorId: string,
): Promise<InvitedStaff> {
  const role = await db.role.findUnique({ where: { name: input.role } });
  if (!role) {
    throw new AuthError(500, "ROLES_NOT_SEEDED", "Roles are not seeded.");
  }
  const existing = await db.user.findFirst({ where: { email: input.email } });
  if (existing) {
    throw new AuthError(409, "EMAIL_TAKEN", "An account with this email already exists in this school.");
  }
  const password = tempPassword();
  const { staff } = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        schoolId,
        email: input.email,
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
        name: input.name,
        roleId: role.id,
      },
    });
    const created = await tx.staff.create({
      data: {
        schoolId,
        userId: user.id,
        designation: input.designation ?? (input.role === "TEACHER" ? "Teacher" : "Accountant"),
      },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
    await recordAudit(tx as unknown as PrismaClient, {
      schoolId,
      actorId,
      action: "USER_CREATE",
      entity: "User",
      entityId: input.email,
      after: { role: input.role, isActive: true },
    });
    return { staff: created };
  });
  // A new teacher shifts counts and class lists (§12.3).
  invalidateTeacherBoards(schoolId);
  invalidateStaffCounts(schoolId);
  return { staff: { id: staff.id, designation: staff.designation, user: staff.user }, tempPassword: password };
}

// Teacher qualification assignment (§9.1 teacher_subjects): which subjects
// a teacher may be scheduled to teach. Only TEACHER-role staff qualify —
// assigning a subject to an accountant is a 404 (no such teacher here),
// not a silent row. Scoped lookups make foreign staff/subject ids 404.
export async function assignSubject(db: PrismaClient, staffId: string, subjectId: string) {
  const staff = await db.staff.findFirst({
    where: { id: staffId },
    include: { user: { select: { role: true } } },
  });
  if (!staff || staff.user.role.name !== "TEACHER") {
    throw new AuthError(404, "TEACHER_NOT_FOUND", "No teacher with that id in this school.");
  }
  const subject = await db.subject.findFirst({ where: { id: subjectId } });
  if (!subject) {
    throw new AuthError(404, "SUBJECT_NOT_FOUND", "Subject not found in this school.");
  }
  const existing = await db.teacherSubject.findUnique({
    where: { staffId_subjectId: { staffId: staff.id, subjectId: subject.id } },
  });
  if (existing) {
    throw new AuthError(409, "ALREADY_ASSIGNED", "This teacher is already qualified for the subject.");
  }
  return db.teacherSubject.create({
    data: { schoolId: staff.schoolId, staffId: staff.id, subjectId: subject.id },
    include: { subject: { select: { name: true } } },
  });
}

export async function unassignSubject(db: PrismaClient, staffId: string, subjectId: string): Promise<void> {
  const row = await db.teacherSubject.findFirst({
    where: { staffId, subjectId },
  });
  if (!row) {
    throw new AuthError(404, "ASSIGNMENT_NOT_FOUND", "That qualification is not assigned.");
  }
  await db.teacherSubject.delete({ where: { id: row.id } });
}
