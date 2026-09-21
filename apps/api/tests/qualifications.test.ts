import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string; adminEmail: string }> {
  const adminEmail = `qual-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Qual School ${uid()}`,
      adminName: "Qual Admin",
      adminEmail,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
    adminEmail,
  };
}

async function makeTeacher(
  schoolId: string,
  slug: string,
): Promise<{ token: string; staffId: string; email: string }> {
  const email = `qual-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  if (!role) {
    throw new Error("TEACHER role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Qual Teacher" },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, staffId: staff.id, email };
}

async function makeSubject(schoolId: string, name: string): Promise<string> {
  const subject = await prisma.subject.create({ data: { schoolId, name: `${name} ${uid()}`, group: "Core" } });
  return subject.id;
}

describe("teacher qualification assignment (§9.1 teacher_subjects)", () => {
  it("assigns, lists, rejects duplicates, and unassigns", async () => {
    const realSchool = await registerSchool();
    const realTeacher = await makeTeacher(realSchool.schoolId, realSchool.slug);
    const subjectId = await makeSubject(realSchool.schoolId, "Mathematics");

    const assigned = await request(app)
      .post(`/api/v1/schools/${realSchool.schoolId}/teachers/${realTeacher.staffId}/subjects`)
      .set("Authorization", `Bearer ${realSchool.adminToken}`)
      .send({ subjectId })
      .expect(201);
    expect(assigned.body.data.assignment.subject.name).toContain("Mathematics");

    const list = await request(app)
      .get(`/api/v1/schools/${realSchool.schoolId}/teachers/${realTeacher.staffId}/subjects`)
      .set("Authorization", `Bearer ${realSchool.adminToken}`)
      .expect(200);
    expect((list.body.data.subjects as { subject: { id: string } }[]).map((s) => s.subject.id)).toEqual([subjectId]);

    const dupe = await request(app)
      .post(`/api/v1/schools/${realSchool.schoolId}/teachers/${realTeacher.staffId}/subjects`)
      .set("Authorization", `Bearer ${realSchool.adminToken}`)
      .send({ subjectId })
      .expect(409);
    expect(dupe.body.error.code).toBe("ALREADY_ASSIGNED");

    await request(app)
      .delete(`/api/v1/schools/${realSchool.schoolId}/teachers/${realTeacher.staffId}/subjects/${subjectId}`)
      .set("Authorization", `Bearer ${realSchool.adminToken}`)
      .expect(200);

    const gone = await request(app)
      .get(`/api/v1/schools/${realSchool.schoolId}/teachers/${realTeacher.staffId}/subjects`)
      .set("Authorization", `Bearer ${realSchool.adminToken}`)
      .expect(200);
    expect(gone.body.data.subjects).toEqual([]);

    const missing = await request(app)
      .delete(`/api/v1/schools/${realSchool.schoolId}/teachers/${realTeacher.staffId}/subjects/${subjectId}`)
      .set("Authorization", `Bearer ${realSchool.adminToken}`)
      .expect(404);
    expect(missing.body.error.code).toBe("ASSIGNMENT_NOT_FOUND");
  });

  it("rejects non-teachers, foreign ids, non-admin callers, and strangers", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const teacherA = await makeTeacher(schoolA.schoolId, schoolA.slug);
    const subjectA = await makeSubject(schoolA.schoolId, "Physics");
    const subjectB = await makeSubject(schoolB.schoolId, "Physics");

    // Accountant's staff row is not a teacher.
    const accountantRole = await prisma.role.findUnique({ where: { name: "ACCOUNTANT" } });
    const accountantUser = await prisma.user.create({
      data: {
        schoolId: schoolA.schoolId,
        roleId: accountantRole?.id ?? "",
        email: `qual-acct-${uid()}@example.com`,
        passwordHash: "x",
        name: "Qual Accountant",
      },
    });
    const accountantStaff = await prisma.staff.create({
      data: { schoolId: schoolA.schoolId, userId: accountantUser.id, designation: "Accountant" },
    });

    const notTeacher = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/teachers/${accountantStaff.id}/subjects`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ subjectId: subjectA })
      .expect(404);
    expect(notTeacher.body.error.code).toBe("TEACHER_NOT_FOUND");

    const foreignSubject = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/teachers/${teacherA.staffId}/subjects`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ subjectId: subjectB })
      .expect(404);
    expect(foreignSubject.body.error.code).toBe("SUBJECT_NOT_FOUND");

    const foreignStaff = await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/teachers/${teacherA.staffId}/subjects`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .send({ subjectId: subjectB })
      .expect(404);
    expect(foreignStaff.body.error.code).toBe("TEACHER_NOT_FOUND");

    const teacherCaller = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/teachers/${teacherA.staffId}/subjects`)
      .set("Authorization", `Bearer ${teacherA.token}`)
      .send({ subjectId: subjectA })
      .expect(403);
    expect(teacherCaller.body.error.code).toBe("PERMISSION_DENIED");

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/teachers/${teacherA.staffId}/subjects`)
      .send({ subjectId: subjectA })
      .expect(401);
  });
});
