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

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Homework School ${uid()}`,
      adminName: "Homework Admin",
      adminEmail: `homework-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSection(schoolId: string, name: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name } });
  return section.id;
}

async function makeSubject(schoolId: string, name: string): Promise<string> {
  const subject = await prisma.subject.create({ data: { schoolId, name: `${name} ${uid()}`, group: "Core" } });
  return subject.id;
}

async function makeTeacher(
  schoolId: string,
  slug: string,
  qualifiedSubjectIds: string[],
  classTeacherOf: string | null,
): Promise<string> {
  const email = `hw-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  if (!role) {
    throw new Error("TEACHER role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "HW Teacher" },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  if (classTeacherOf) {
    await prisma.section.update({ where: { id: classTeacherOf }, data: { classTeacherId: staff.id } });
  }
  for (const subjectId of qualifiedSubjectIds) {
    await prisma.teacherSubject.create({ data: { schoolId, staffId: staff.id, subjectId } });
  }
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

function postBody(sectionId: string, subjectId: string) {
  return {
    sectionId,
    subjectId,
    title: "Algebra Worksheet 2",
    description: "Solve problems 21 through 40 from chapter 3 before Friday.",
    dueDate: "2026-10-03",
  };
}

describe("POST /api/v1/schools/:schoolId/homework (§7 Phase 1 #6)", () => {
  it("lets a qualified class teacher post, and the admin post", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId, "A");
    const math = await makeSubject(schoolId, "Mathematics");
    const teacherToken = await makeTeacher(schoolId, slug, [math], sectionA);

    const posted = await request(app)
      .post(`/api/v1/schools/${schoolId}/homework`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send(postBody(sectionA, math))
      .expect(201);
    expect(posted.body.data.homework.title).toBe("Algebra Worksheet 2");
    expect(posted.body.data.homework.teacher.user.name).toBe("HW Teacher");

    const byAdmin = await request(app)
      .post(`/api/v1/schools/${schoolId}/homework`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...postBody(sectionA, math), title: "Admin-posted Worksheet" })
      .expect(201);
    expect(byAdmin.body.data.homework.teacher.user.name).toBe("HW Teacher");
  });

  it("blocks unqualified subjects, unrelated sections, students, and strangers", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const sectionA = await makeSection(schoolA.schoolId, "A");
    const sectionB = await makeSection(schoolA.schoolId, "B");
    const math = await makeSubject(schoolA.schoolId, "Mathematics");
    const art = await makeSubject(schoolA.schoolId, "Art");
    const foreign = await makeSubject(schoolB.schoolId, "Mathematics");
    // Qualified in math, class teacher of A only.
    const teacherToken = await makeTeacher(schoolA.schoolId, schoolA.slug, [math], sectionA);
    const studentRole = await prisma.role.findUnique({ where: { name: "STUDENT" } });
    const studentEmail = `hw-student-${uid()}@example.com`;
    const studentPassword = "student-pass-123";
    await prisma.user.create({
      data: {
        schoolId: schoolA.schoolId,
        roleId: studentRole?.id ?? "",
        email: studentEmail,
        passwordHash: await bcrypt.hash(studentPassword, 4),
        name: "HW Student",
      },
    });
    const studentLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: studentEmail, password: studentPassword, schoolSlug: schoolA.slug })
      .expect(200);
    const studentDenied = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/homework`)
      .set("Authorization", `Bearer ${studentLogin.body.data.accessToken as string}`)
      .send(postBody(sectionA, math))
      .expect(403);
    expect(studentDenied.body.error.code).toBe("PERMISSION_DENIED");

    // Art: qualified nowhere.
    const unqualified = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/homework`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send(postBody(sectionA, art))
      .expect(403);
    expect(unqualified.body.error.code).toBe("NOT_SUBJECT_TEACHER");

    // Math but section B (not theirs, no timetable slot either).
    const outsider = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/homework`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send(postBody(sectionB, math))
      .expect(403);
    expect(outsider.body.error.code).toBe("NOT_SUBJECT_TEACHER");

    // Foreign subject id.
    const foreignSubject = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/homework`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send(postBody(sectionA, foreign))
      .expect(404);
    expect(foreignSubject.body.error.code).toBe("SUBJECT_NOT_FOUND");

    // Cross-tenant URL.
    const cross = await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/homework`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send(postBody(sectionA, math))
      .expect(403);
    expect(cross.body.error.code).toBe("TENANT_MISMATCH");

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/homework`)
      .send(postBody(sectionA, math))
      .expect(401);
  });
});
