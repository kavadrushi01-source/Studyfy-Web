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
      schoolName: `Ledger School ${uid()}`,
      adminName: "Ledger Admin",
      adminEmail: `ledger-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function loginAs(
  schoolId: string,
  slug: string,
  roleName: string,
): Promise<{ token: string; userId: string }> {
  const email = `ledger-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "user-pass-123";
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`${roleName} role must be seeded`);
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} User` },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id };
}

async function admitStudent(
  schoolId: string,
  adminToken: string,
  sectionId: string,
): Promise<{ studentId: string; email: string }> {
  const email = `ledger-student-${uid()}@example.com`;
  const res = await request(app)
    .post(`/api/v1/schools/${schoolId}/students`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Ledger Student", email, sectionId })
    .expect(201);
  return { studentId: res.body.data.student.id as string, email };
}

async function makeSection(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  return section.id;
}

describe("GET /api/v1/schools/:schoolId/fees/invoices (ledger)", () => {
  it("shows the accountant everything with exact header totals", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const s1 = await admitStudent(schoolId, adminToken, sectionId);
    const s2 = await admitStudent(schoolId, adminToken, sectionId);
    const accountant = await loginAs(schoolId, slug, "ACCOUNTANT");

    const cls = await prisma.class.findFirst({ where: { schoolId } });
    const structure = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/structures`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ classId: cls?.id ?? "", name: "Term 1 Tuition", amount: "10000", term: "Term 1", category: "TUITION" })
      .expect(201);
    await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ structureId: structure.body.data.structure.id as string, sectionId, dueDate: "2026-11-15" })
      .expect(201);
    // Partially pay the first invoice: 4000 of 10000.
    const first = await prisma.feeInvoice.findFirst({ where: { schoolId, studentId: s1.studentId } });
    await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${first?.id ?? ""}/pay`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "4000", method: "CASH" })
      .expect(200);

    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/invoices?pageSize=50`)
      .set("Authorization", `Bearer ${accountant.token}`)
      .expect(200);

    expect(res.body.data.totals.count).toBe(2);
    // 6000 remaining on invoice 1 + 10000 on invoice 2.
    expect(Number(res.body.data.totals.outstanding)).toBe(16000);
    const statuses = (res.body.data.invoices as { status: string }[]).map((i) => i.status).sort();
    expect(statuses).toEqual(["PARTIAL", "PENDING"]);
    const partial = (res.body.data.invoices as { status: string; outstanding: string }[]).find(
      (i) => i.status === "PARTIAL",
    );
    expect(Number(partial?.outstanding)).toBe(6000);
    void s2;
  });

  it("pins students to own invoices and parents to linked ones, 403s the rest", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const s1 = await admitStudent(schoolId, adminToken, sectionId);
    const s2 = await admitStudent(schoolId, adminToken, sectionId);

    const cls = await prisma.class.findFirst({ where: { schoolId } });
    const structure = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/structures`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ classId: cls?.id ?? "", name: "Term 1 Tuition", amount: "5000", term: "Term 1", category: "TUITION" })
      .expect(201);
    await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ structureId: structure.body.data.structure.id as string, sectionId, dueDate: "2026-11-15" })
      .expect(201);

    // Link a parent to s1 only.
    const parentRole = await prisma.role.findUnique({ where: { name: "PARENT" } });
    const parentEmail = `ledger-parent-${uid()}@example.com`;
    const parentPassword = "parent-pass-123";
    const parent = await prisma.user.create({
      data: {
        schoolId,
        roleId: parentRole?.id ?? "",
        email: parentEmail,
        passwordHash: await bcrypt.hash(parentPassword, 4),
        name: "Ledger Parent",
      },
    });
    await prisma.studentGuardian.create({
      data: { schoolId, studentId: s1.studentId, parentId: parent.id, relationship: "Father" },
    });
    const parentLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: parentEmail, password: parentPassword, schoolSlug: slug })
      .expect(200);
    const parentToken = parentLogin.body.data.accessToken as string;

    const parentList = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/invoices`)
      .set("Authorization", `Bearer ${parentToken}`)
      .expect(200);
    expect(parentList.body.data.totals.count).toBe(1);
    expect(
      (parentList.body.data.invoices as { student: { id: string } }[])[0]?.student.id,
    ).toBe(s1.studentId);

    const foreign = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/invoices?studentId=${s2.studentId}`)
      .set("Authorization", `Bearer ${parentToken}`)
      .expect(403);
    expect(foreign.body.error.code).toBe("FORBIDDEN");

    // Teacher has no fees.read at all.
    const teacher = await loginAs(schoolId, slug, "TEACHER");
    const teacherBlocked = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/invoices`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(403);
    expect(teacherBlocked.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("filters by status and validates query", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    await admitStudent(schoolId, adminToken, sectionId);

    const cls = await prisma.class.findFirst({ where: { schoolId } });
    const structure = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/structures`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ classId: cls?.id ?? "", name: "Term 1 Tuition", amount: "5000", term: "Term 1", category: "TUITION" })
      .expect(201);
    await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ structureId: structure.body.data.structure.id as string, sectionId, dueDate: "2026-11-15" })
      .expect(201);

    const pending = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/invoices?status=PENDING`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(pending.body.data.totals.count).toBe(1);

    const paid = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/invoices?status=PAID`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(paid.body.data.totals.count).toBe(0);

    const bad = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/invoices?status=FORGIVEN`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });
});
