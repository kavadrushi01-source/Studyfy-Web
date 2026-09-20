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
      schoolName: `Fees School ${uid()}`,
      adminName: "Fees Admin",
      adminEmail: `fees-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeClass(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  return cls.id;
}

async function loginAs(
  schoolId: string,
  slug: string,
  roleName: string,
): Promise<string> {
  const email = `fees-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "user-pass-123";
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`${roleName} role must be seeded`);
  }
  await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} User` },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

function structureBody(classId: string) {
  return {
    classId,
    name: "Term 2 Tuition",
    amount: "15250.50",
    term: "Term 2",
    category: "TUITION",
  };
}

describe("POST /api/v1/schools/:schoolId/fees/structures", () => {
  it("lets Admin and Accountant create exact-decimal structures", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const classId = await makeClass(schoolId);
    const accountantToken = await loginAs(schoolId, slug, "ACCOUNTANT");

    const first = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/structures`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(structureBody(classId))
      .expect(201);
    // Decimal crosses JSON without trailing zeros ("15250.5") — the §13.6
    // rule: coerce with Number() before comparing, never string-match.
    expect(Number(first.body.data.structure.amount)).toBe(15250.5);
    expect(first.body.data.structure.term).toBe("Term 2");
    expect(first.body.data.structure.category).toBe("TUITION");

    const otherClass = await makeClass(schoolId);
    await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/structures`)
      .set("Authorization", `Bearer ${accountantToken}`)
      .send({ ...structureBody(otherClass), name: "Bus Fee", amount: "3200", category: "TRANSPORT" })
      .expect(201);

    const row = await prisma.feeStructure.findFirst({ where: { schoolId, name: "Bus Fee" } });
    expect(Number(row?.amount)).toBe(3200);
  });

  it("rejects teachers (403), bad amounts (400), dup names (409), foreign classes (404)", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const classA = await makeClass(schoolA.schoolId);
    const classB = await makeClass(schoolB.schoolId);
    const teacherToken = await loginAs(schoolA.schoolId, schoolA.slug, "TEACHER");

    const denied = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/structures`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send(structureBody(classA))
      .expect(403);
    expect(denied.body.error.code).toBe("PERMISSION_DENIED");

    for (const amount of ["0", "-50", "12.345", "free"]) {
      const bad = await request(app)
        .post(`/api/v1/schools/${schoolA.schoolId}/fees/structures`)
        .set("Authorization", `Bearer ${schoolA.adminToken}`)
        .send({ ...structureBody(classA), name: `Fee ${uid()}`, amount })
        .expect(400);
      expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    }

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/structures`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send(structureBody(classA))
      .expect(201);
    const dupe = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/structures`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send(structureBody(classA))
      .expect(409);
    expect(dupe.body.error.code).toBe("STRUCTURE_EXISTS");

    const foreign = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/structures`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send(structureBody(classB))
      .expect(404);
    expect(foreign.body.error.code).toBe("CLASS_NOT_FOUND");

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/structures`)
      .send(structureBody(classA))
      .expect(401);
  });
});
