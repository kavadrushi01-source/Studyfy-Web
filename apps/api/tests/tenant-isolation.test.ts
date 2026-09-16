import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(name: string): Promise<{ schoolId: string; slug: string; token: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: name,
      adminName: "Tenant Admin",
      adminEmail: `tenant-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    token: res.body.data.accessToken as string,
  };
}

async function createStudent(schoolId: string, sectionName: string): Promise<string> {
  const studentRole = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!studentRole) {
    throw new Error("STUDENT role must be seeded");
  }
  let section = await prisma.section.findFirst({ where: { schoolId, name: sectionName } });
  if (!section) {
    const cls = await prisma.class.create({ data: { schoolId, name: `Class ${sectionName}` } });
    section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: sectionName } });
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: studentRole.id,
      email: `student-${uid()}@example.com`,
      passwordHash: "not-a-real-login",
      name: "Tenant Student",
    },
  });
  const student = await prisma.student.create({
    data: { schoolId, userId: user.id, sectionId: section.id },
  });
  return student.id;
}

describe("tenant isolation (SECURITY_PATTERNS.md §1)", () => {
  it("rejects school A's token reading school B's students with 403", async () => {
    const schoolA = await registerSchool(`Tenant School A ${uid()}`);
    const schoolB = await registerSchool(`Tenant School B ${uid()}`);
    await createStudent(schoolB.schoolId, "B1");

    const res = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/students`)
      .set("Authorization", `Bearer ${schoolA.token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("TENANT_MISMATCH");
  });

  it("lets school A's token read school A's students — and only A's", async () => {
    const schoolA = await registerSchool(`Tenant School A2 ${uid()}`);
    const schoolB = await registerSchool(`Tenant School B2 ${uid()}`);
    const studentA = await createStudent(schoolA.schoolId, "A1");
    const studentB = await createStudent(schoolB.schoolId, "B1");

    const res = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/students`)
      .set("Authorization", `Bearer ${schoolA.token}`)
      .expect(200);

    const ids = (res.body.data.students as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(studentA);
    expect(ids).not.toContain(studentB);
  });
});
