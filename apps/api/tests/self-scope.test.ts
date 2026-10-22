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
      schoolName: `Selfscope School ${uid()}`,
      adminName: "Selfscope Admin",
      adminEmail: `selfscope-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function createSection(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: `Sec ${uid()}` } });
  return section.id;
}

async function createStudentUser(
  schoolId: string,
  sectionId: string,
  password = "student-pass-123",
): Promise<{ token: string; studentId: string }> {
  const email = `student-${uid()}@example.com`;
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email,
      passwordHash: await bcrypt.hash(password, 4),
      name: "Scope Student",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, schoolSlug: (await prisma.school.findUnique({ where: { id: schoolId } }))?.slug })
    .expect(200);
  return { token: login.body.data.accessToken as string, studentId: student.id };
}

async function createParentUser(schoolId: string, slug: string, linkedStudentId: string): Promise<string> {
  const email = `parent-${uid()}@example.com`;
  const password = "parent-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "PARENT" } });
  if (!role) {
    throw new Error("PARENT role must be seeded");
  }
  const parent = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email,
      passwordHash: await bcrypt.hash(password, 4),
      name: "Scope Parent",
    },
  });
  await prisma.studentGuardian.create({
    data: { schoolId, studentId: linkedStudentId, parentId: parent.id, relationship: "Father" },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

async function loginAsTeacher(schoolId: string, slug: string): Promise<string> {
  const email = `teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  if (!role) {
    throw new Error("TEACHER role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Scope Teacher" },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

describe("student/parent self-scope (SECURITY_PATTERNS.md §3)", () => {
  it("rejects a student reading another student's record with 403", async () => {
    const { schoolId, slug } = await registerSchool();
    void slug;
    const sectionId = await createSection(schoolId);
    const studentA = await createStudentUser(schoolId, sectionId);
    const studentB = await createStudentUser(schoolId, sectionId);

    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${studentB.studentId}`)
      .set("Authorization", `Bearer ${studentA.token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects a parent reading a non-linked child's record with 403", async () => {
    const { schoolId, slug } = await registerSchool();
    const sectionId = await createSection(schoolId);
    const childA = await createStudentUser(schoolId, sectionId);
    const childB = await createStudentUser(schoolId, sectionId);
    const parentToken = await createParentUser(schoolId, slug, childA.studentId);

    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${childB.studentId}`)
      .set("Authorization", `Bearer ${parentToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("lets a student read their own record — and a list shows only them", async () => {
    const { schoolId } = await registerSchool();
    const sectionId = await createSection(schoolId);
    const studentA = await createStudentUser(schoolId, sectionId);
    const studentB = await createStudentUser(schoolId, sectionId);

    await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${studentA.studentId}`)
      .set("Authorization", `Bearer ${studentA.token}`)
      .expect(200);

    const list = await request(app)
      .get(`/api/v1/schools/${schoolId}/students`)
      .set("Authorization", `Bearer ${studentA.token}`)
      .expect(200);
    const ids = (list.body.data.students as { id: string }[]).map((s) => s.id);
    expect(ids).toEqual([studentA.studentId]);
    expect(ids).not.toContain(studentB.studentId);
  });

  it("lets a parent read a linked child — and a list shows only linked children", async () => {
    const { schoolId, slug } = await registerSchool();
    const sectionId = await createSection(schoolId);
    const childA = await createStudentUser(schoolId, sectionId);
    const childB = await createStudentUser(schoolId, sectionId);
    const parentToken = await createParentUser(schoolId, slug, childA.studentId);

    await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${childA.studentId}`)
      .set("Authorization", `Bearer ${parentToken}`)
      .expect(200);

    const list = await request(app)
      .get(`/api/v1/schools/${schoolId}/students`)
      .set("Authorization", `Bearer ${parentToken}`)
      .expect(200);
    const ids = (list.body.data.students as { id: string }[]).map((s) => s.id);
    expect(ids).toEqual([childA.studentId]);
    expect(ids).not.toContain(childB.studentId);
  });

  it("lets School Admin read any in-school student, while a Teacher is scoped to their class sections", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await createSection(schoolId);
    const sectionB = await createSection(schoolId);
    const own = await createStudentUser(schoolId, sectionA);
    const foreign = await createStudentUser(schoolId, sectionB);

    // Admin keeps the full school lane (STAFF_MANAGERS-style pass-through).
    const adminRes = await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${own.studentId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(adminRes.body.data.student.id).toBe(own.studentId);

    // A teacher without an assigned section sees nothing (fail-closed 404).
    const tokenless = await loginAsTeacher(schoolId, slug);
    await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${own.studentId}`)
      .set("Authorization", `Bearer ${tokenless}`)
      .expect(404);

    // A class teacher reads their own pupil — and never a foreign section's.
    const staffRow = await prisma.staff.findFirst({ where: { userId: (await prisma.user.findFirst({ where: { schoolId, email: { contains: "teacher-" } } }))?.id }, select: { id: true } });
    if (!staffRow) {
      throw new Error("teacher staff row must exist");
    }
    await prisma.section.update({ where: { id: sectionA }, data: { classTeacherId: staffRow.id } });
    const ownRes = await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${own.studentId}`)
      .set("Authorization", `Bearer ${tokenless}`)
      .expect(200);
    expect(ownRes.body.data.student.id).toBe(own.studentId);
    await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${foreign.studentId}`)
      .set("Authorization", `Bearer ${tokenless}`)
      .expect(404);
  });
});
