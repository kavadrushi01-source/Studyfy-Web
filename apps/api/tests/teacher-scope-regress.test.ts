import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

// Regression pack for the L4 teacher-scope fix: a TEACHER's reads on a
// specific pupil (detail, ID card, attendance summary) obey the same
// class-teacher rule as the list/marks gates (§9.1). A foreign-section
// pupil must look exactly like a missing one (404) — staff reads never
// widen and never leak existence.

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Scopecross School ${uid()}`,
      adminName: "Scope Admin",
      adminEmail: `scope-admin-${uid()}@example.com`,
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
  const cls = await prisma.class.create({ data: { schoolId, name: `Scope ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name } });
  return section.id;
}

async function makeStudent(schoolId: string, sectionId: string): Promise<string> {
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email: `scope-student-${uid()}@example.com`, passwordHash: "x", name: "Scope Student" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  return student.id;
}

async function makeClassTeacher(schoolId: string, slug: string, classTeacherOf: string): Promise<string> {
  const email = `scope-teacher-${uid()}@example.com`;
  const password = "staff-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  if (!role) {
    throw new Error("TEACHER role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Scope Teacher" },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "TEACHER" } });
  await prisma.section.update({ where: { id: classTeacherOf }, data: { classTeacherId: staff.id } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

describe("teacher scoping on specific-pupil routes", () => {
  it("404s a foreign-section pupil on detail, id-card and attendance summary — and keeps own-section reads working", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId, "A");
    const sectionB = await makeSection(schoolId, "B");
    const own = await makeStudent(schoolId, sectionA);
    const foreign = await makeStudent(schoolId, sectionB);
    const teacher = await makeClassTeacher(schoolId, slug, sectionA);

    // Detail: own pupil reads, foreign pupil 404s (never 403, never data).
    const ownDetail = await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${own}`)
      .set("Authorization", `Bearer ${teacher}`)
      .expect(200);
    expect(ownDetail.body.data.student.id).toBe(own);
    const foreignDetail = await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${foreign}`)
      .set("Authorization", `Bearer ${teacher}`)
      .expect(404);
    expect(foreignDetail.body.error.code).toBe("NOT_FOUND");

    // ID card: same shape.
    await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${own}/id-card`)
      .set("Authorization", `Bearer ${teacher}`)
      .expect(200);
    await request(app)
      .get(`/api/v1/schools/${schoolId}/students/${foreign}/id-card`)
      .set("Authorization", `Bearer ${teacher}`)
      .expect(404);

    // Attendance summary: own pupil returns rows; foreign pupil 404s.
    await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId: sectionA, date: "2026-09-01", records: [{ studentId: own, status: "PRESENT" }] })
      .expect(200);
    const ownSum = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/summary?from=2026-09-01&to=2026-09-01&studentId=${own}`)
      .set("Authorization", `Bearer ${teacher}`)
      .expect(200);
    expect((ownSum.body.data.summary as { studentId: string }[]).map((r) => r.studentId)).toEqual([own]);
    const foreignSum = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/summary?from=2026-09-01&to=2026-09-01&studentId=${foreign}`)
      .set("Authorization", `Bearer ${teacher}`)
      .expect(404);
    expect(foreignSum.body.error.code).toBe("NOT_FOUND");
  });

  it("keeps School Admin on the old unrestricted lane (reads both sections)", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId, "A");
    const sectionB = await makeSection(schoolId, "B");
    const a = await makeStudent(schoolId, sectionA);
    const b = await makeStudent(schoolId, sectionB);
    for (const id of [a, b]) {
      await request(app)
        .get(`/api/v1/schools/${schoolId}/students/${id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
    }
  });
});
