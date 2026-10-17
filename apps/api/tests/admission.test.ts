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
      schoolName: `Admission School ${uid()}`,
      adminName: "Admission Admin",
      adminEmail: `admission-admin-${uid()}@example.com`,
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

async function loginAsTeacher(schoolId: string, slug: string): Promise<string> {
  const email = `teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  if (!role) {
    throw new Error("TEACHER role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Admission Teacher" },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

function admissionBody(sectionId: string, email: string) {
  return {
    name: "New Admit",
    email,
    sectionId,
    admissionNo: `ADM-${uid()}`,
    gender: "Female",
    guardians: [{ name: "Admit Guardian", email: `guardian-${uid()}@example.com`, relationship: "Mother" }],
  };
}

describe("POST /api/v1/schools/:schoolId/students (admission)", () => {
  it(
    "full admission flow",
    // Generous timeout: ~5 bcrypt cost-12 ops (register + admit + 2 logins).
    // Under parallel workers on a laptop that takes seconds; 5s flakes.
    { timeout: 30000 },
    async () => {
    const { schoolId, adminToken, slug } = await registerSchool();
    const sectionId = await createSection(schoolId);
    const email = `admit-${uid()}@example.com`;

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/students`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(admissionBody(sectionId, email))
      .expect(201);

    const studentId = res.body.data.student.id as string;
    const tempPassword = res.body.data.studentTempPassword as string;
    expect(typeof tempPassword).toBe("string");
    expect(tempPassword.length).toBeGreaterThanOrEqual(8);
    expect(res.body.data.guardians).toHaveLength(1);
    expect(res.body.data.guardians[0].tempPassword).toBeTruthy();

    const profile = await prisma.student.findUnique({ where: { id: studentId }, include: { user: true } });
    expect(profile?.user.email).toBe(email);
    expect(profile?.user.roleId).toBe((await prisma.role.findUnique({ where: { name: "STUDENT" } }))?.id);

    // The temp password genuinely logs the student in.
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: tempPassword, schoolSlug: slug })
      .expect(200);

    // The admitted student sees only themselves (self-scope on new rows).
    const studentToken = (
      await request(app).post("/api/v1/auth/login").send({ email, password: tempPassword, schoolSlug: slug })
    ).body.data.accessToken as string;
    const list = await request(app)
      .get(`/api/v1/schools/${schoolId}/students`)
      .set("Authorization", `Bearer ${studentToken}`)
      .expect(200);
    expect((list.body.data.students as { id: string }[]).map((s) => s.id)).toEqual([studentId]);
  });

  it("rejects a guardian using the student's own email with 400", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await createSection(schoolId);
    const email = `self-guardian-${uid()}@example.com`;
    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/students`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        ...admissionBody(sectionId, email),
        guardians: [{ name: "Same Person", email, relationship: "Father" }],
      })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a teacher (read but no write) with 403 PERMISSION_DENIED", async () => {
    const { schoolId, slug } = await registerSchool();
    const sectionId = await createSection(schoolId);
    const teacherToken = await loginAsTeacher(schoolId, slug);

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/students`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send(admissionBody(sectionId, `admit-${uid()}@example.com`))
      .expect(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("rejects a foreign sectionId with 404 (tenant scope, not trust)", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const sectionB = await createSection(schoolB.schoolId);

    const res = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/students`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send(admissionBody(sectionB, `admit-${uid()}@example.com`))
      .expect(404);
    expect(res.body.error.code).toBe("SECTION_NOT_FOUND");
  });

  it("rejects a duplicate email with 409 and bad input with 400", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await createSection(schoolId);
    const email = `dupe-${uid()}@example.com`;

    await request(app)
      .post(`/api/v1/schools/${schoolId}/students`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(admissionBody(sectionId, email))
      .expect(201);

    const dupe = await request(app)
      .post(`/api/v1/schools/${schoolId}/students`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(admissionBody(sectionId, email))
      .expect(409);
    expect(dupe.body.error.code).toBe("EMAIL_TAKEN");

    const bad = await request(app)
      .post(`/api/v1/schools/${schoolId}/students`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: `bad-${uid()}@example.com`, sectionId })
      .expect(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unauthenticated admission with 401", async () => {
    const { schoolId } = await registerSchool();
    const sectionId = await createSection(schoolId);
    await request(app)
      .post(`/api/v1/schools/${schoolId}/students`)
      .send(admissionBody(sectionId, `anon-${uid()}@example.com`))
      .expect(401);
  });

  it("auto-numbers the admission when the office leaves it blank", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await createSection(schoolId);
    const { admissionNo, ...withoutNumber } = admissionBody(sectionId, `nonum-${uid()}@example.com`);
    void admissionNo;
    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/students`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(withoutNumber)
      .expect(201);
    expect(res.body.data.student.admissionNo).toMatch(/^ADM-\d{4}-[0-9A-F]{4}$/);
  }, 30000);
});
