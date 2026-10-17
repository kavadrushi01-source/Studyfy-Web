import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Invoice School ${uid()}`,
      adminName: "Invoice Admin",
      adminEmail: `invoice-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return { schoolId: res.body.data.school.id as string, adminToken: res.body.data.accessToken as string };
}

async function makeClassroom(
  schoolId: string,
  className: string,
  studentCount: number,
): Promise<{ classId: string; sectionId: string; studentIds: string[] }> {
  const cls = await prisma.class.create({ data: { schoolId, name: `${className} ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const studentIds: string[] = [];
  for (let i = 0; i < studentCount; i += 1) {
    const user = await prisma.user.create({
      data: {
        schoolId,
        roleId: role.id,
        email: `invoice-student-${uid()}@example.com`,
        passwordHash: "x",
        name: "Invoice Student",
      },
    });
    const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId: section.id } });
    studentIds.push(student.id);
  }
  return { classId: cls.id, sectionId: section.id, studentIds };
}

async function makeStructure(schoolId: string, adminToken: string, classId: string): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/schools/${schoolId}/fees/structures`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ classId, name: "Term 1 Tuition", amount: "10000", term: "Term 1", category: "TUITION" })
    .expect(201);
  return res.body.data.structure.id as string;
}

describe("POST /api/v1/schools/:schoolId/fees/invoices/generate", () => {
  it("generates one PENDING invoice per student at the structure amount", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const room = await makeClassroom(schoolId, "Grade 9", 3);
    const structureId = await makeStructure(schoolId, adminToken, room.classId);

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ structureId, classId: room.classId, dueDate: "2026-10-15" })
      .expect(201);

    expect(res.body.data.generated).toBe(3);
    expect(res.body.data.skipped).toEqual([]);

    const invoices = await prisma.feeInvoice.findMany({ where: { schoolId, structureId } });
    expect(invoices).toHaveLength(3);
    for (const invoice of invoices) {
      expect(invoice.status).toBe("PENDING");
      expect(Number(invoice.amount)).toBe(10000);
      expect(Number(invoice.amountPaid)).toBe(0);
    }
    expect(new Set(invoices.map((i) => i.studentId)).size).toBe(3);
  });

  it("skips already-billed students on re-run (never double-bills)", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const room = await makeClassroom(schoolId, "Grade 10", 2);
    const structureId = await makeStructure(schoolId, adminToken, room.classId);

    await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ structureId, classId: room.classId, dueDate: "2026-10-15" })
      .expect(201);

    const rerun = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ structureId, classId: room.classId, dueDate: "2026-10-15" })
      .expect(201);

    expect(rerun.body.data.generated).toBe(0);
    expect(rerun.body.data.skipped).toHaveLength(2);
    expect(await prisma.feeInvoice.count({ where: { schoolId, structureId } })).toBe(2);
  });

  it("concurrent runs never double-bill the same pupil", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const room = await makeClassroom(schoolId, "Grade 11", 3);
    const structureId = await makeStructure(schoolId, adminToken, room.classId);
    const auth = { Authorization: `Bearer ${adminToken}` };
    const body = { structureId, classId: room.classId, dueDate: "2026-10-15" };

    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/schools/${schoolId}/fees/invoices/generate`).set(auth).send(body),
      request(app).post(`/api/v1/schools/${schoolId}/fees/invoices/generate`).set(auth).send(body),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.generated + second.body.data.generated).toBe(3);

    const invoices = await prisma.feeInvoice.findMany({ where: { schoolId, structureId } });
    expect(invoices).toHaveLength(3);
    expect(new Set(invoices.map((i) => i.studentId)).size).toBe(3);
  });

  it("targets one section or an explicit list, and rejects mixed modes + foreign ids", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const roomA = await makeClassroom(schoolA.schoolId, "Grade 9", 2);
    const roomB = await makeClassroom(schoolB.schoolId, "Grade 9", 1);
    const structureId = await makeStructure(schoolA.schoolId, schoolA.adminToken, roomA.classId);

    const sectionOnly = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ structureId, sectionId: roomA.sectionId, dueDate: "2026-10-15" })
      .expect(201);
    expect(sectionOnly.body.data.generated).toBe(2);

    const mixed = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ structureId, classId: roomA.classId, sectionId: roomA.sectionId, dueDate: "2026-10-15" })
      .expect(400);
    expect(mixed.body.error.code).toBe("VALIDATION_ERROR");

    const foreignSection = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ structureId, sectionId: roomB.sectionId, dueDate: "2026-10-15" })
      .expect(404);
    expect(foreignSection.body.error.code).toBe("SECTION_NOT_FOUND");

    const foreignList = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ structureId, studentIds: roomB.studentIds, dueDate: "2026-10-15" })
      .expect(404);
    expect(foreignList.body.error.code).toBe("STUDENT_NOT_FOUND");
  });

  it("rejects cross-tenant generation and unauthenticated calls", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const roomA = await makeClassroom(schoolA.schoolId, "Grade 9", 1);
    const structureId = await makeStructure(schoolA.schoolId, schoolA.adminToken, roomA.classId);

    const cross = await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ structureId, classId: roomA.classId, dueDate: "2026-10-15" })
      .expect(403);
    expect(cross.body.error.code).toBe("TENANT_MISMATCH");

    // A's structure id is invisible from B: scoped lookup 404s.
    const invisible = await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .send({ structureId, classId: roomA.classId, dueDate: "2026-10-15" })
      .expect(404);
    expect(invisible.body.error.code).toBe("STRUCTURE_NOT_FOUND");

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/invoices/generate`)
      .send({ structureId, classId: roomA.classId, dueDate: "2026-10-15" })
      .expect(401);
  });
});
