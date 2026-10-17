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
      schoolName: `Pay School ${uid()}`,
      adminName: "Pay Admin",
      adminEmail: `pay-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function setupInvoice(
  schoolId: string,
  adminToken: string,
  amount: string,
): Promise<{ invoiceId: string; studentId: string }> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: `pay-student-${uid()}@example.com`,
      passwordHash: "x",
      name: "Pay Student",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId: section.id } });
  const structure = await request(app)
    .post(`/api/v1/schools/${schoolId}/fees/structures`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ classId: cls.id, name: "Term 1 Tuition", amount, term: "Term 1", category: "TUITION" })
    .expect(201);
  const gen = await request(app)
    .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ structureId: structure.body.data.structure.id as string, sectionId: section.id, dueDate: "2026-11-15" })
    .expect(201);
  expect(gen.body.data.generated).toBe(1);
  const invoice = await prisma.feeInvoice.findFirst({ where: { schoolId, studentId: student.id } });
  if (!invoice) {
    throw new Error("Invoice was not generated");
  }
  return { invoiceId: invoice.id, studentId: student.id };
}

async function loginAs(schoolId: string, slug: string, roleName: string): Promise<string> {
  const email = `pay-${roleName.toLowerCase()}-${uid()}@example.com`;
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

describe("POST /api/v1/schools/:schoolId/fees/invoices/:invoiceId/pay", () => {
  it("records a full cash payment (PAID) and partials that accumulate exactly", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const { invoiceId } = await setupInvoice(schoolId, adminToken, "10000");

    const full = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "10000", method: "CASH" })
      .expect(200);
    expect(full.body.data.invoice.status).toBe("PAID");
    expect(Number(full.body.data.invoice.amountPaid)).toBe(10000);
    expect(full.body.data.payment.method).toBe("CASH");

    // Settled invoices refuse further payment.
    const settled = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "100", method: "CASH" })
      .expect(409);
    expect(settled.body.error.code).toBe("INVOICE_SETTLED");

    // Paise-exact partials: 3333.33 + 6666.67 settles 10000.00 with no float drift.
    const second = await setupInvoice(schoolId, adminToken, "10000");
    const part1 = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${second.invoiceId}/pay`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "3333.33", method: "UPI" })
      .expect(200);
    expect(part1.body.data.invoice.status).toBe("PARTIAL");
    const part2 = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${second.invoiceId}/pay`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "6666.67", method: "UPI" })
      .expect(200);
    expect(part2.body.data.invoice.status).toBe("PAID");
    expect(Number(part2.body.data.invoice.amountPaid)).toBe(10000);
  });

  it("keeps OVERDUE on a partial payment of a past-due invoice", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const { invoiceId } = await setupInvoice(schoolId, adminToken, "10000");
    await prisma.feeInvoice.update({ where: { id: invoiceId }, data: { status: "OVERDUE" } });

    const part = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "1000", method: "CASH" })
      .expect(200);
    expect(part.body.data.invoice.status).toBe("OVERDUE");
    expect(Number(part.body.data.invoice.amountPaid)).toBe(1000);
  });

  it("rejects overpayment, bad amounts, RAZORPAY method, and wrong roles/tenants", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const { invoiceId } = await setupInvoice(schoolA.schoolId, schoolA.adminToken, "10000");
    const teacherToken = await loginAs(schoolA.schoolId, schoolA.slug, "TEACHER");

    const over = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ amount: "10000.01", method: "CASH" })
      .expect(400);
    expect(over.body.error.code).toBe("OVERPAYMENT");

    for (const amount of ["0", "-5", "10.999"]) {
      const bad = await request(app)
        .post(`/api/v1/schools/${schoolA.schoolId}/fees/invoices/${invoiceId}/pay`)
        .set("Authorization", `Bearer ${schoolA.adminToken}`)
        .send({ amount, method: "CASH" })
        .expect(400);
      expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    }

    // Online money must arrive via webhook — never this endpoint.
    const gateway = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ amount: "100", method: "RAZORPAY" })
      .expect(400);
    expect(gateway.body.error.code).toBe("VALIDATION_ERROR");

    const teacher = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ amount: "100", method: "CASH" })
      .expect(403);
    expect(teacher.body.error.code).toBe("PERMISSION_DENIED");

    const cross = await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/fees/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .send({ amount: "100", method: "CASH" })
      .expect(404);
    expect(cross.body.error.code).toBe("INVOICE_NOT_FOUND");

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/fees/invoices/${invoiceId}/pay`)
      .send({ amount: "100", method: "CASH" })
      .expect(401);
  });
});

describe("GET /api/v1/schools/:schoolId/fees/payments", () => {
  it("lists newest-first with paging for staff, pins pupils/parents to own", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
    const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
    async function loginablePupil(): Promise<{ token: string; studentId: string; userId: string }> {
      const email = `paylist-pupil-${uid()}@example.com`;
      const password = "pupil-pass-123";
      const role = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
      const user = await prisma.user.create({
        data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Pay Pupil" },
      });
      const profile = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId: section.id } });
      const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
      return { token: login.body.data.accessToken as string, studentId: profile.id, userId: user.id };
    }
    const pupilA = await loginablePupil();
    const pupilB = await loginablePupil();

    const structure = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/structures`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ classId: cls.id, name: "Term 1 Tuition", amount: "10000", term: "Term 1", category: "TUITION" })
      .expect(201);
    await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ structureId: structure.body.data.structure.id as string, sectionId: section.id, dueDate: "2026-11-15" })
      .expect(201);
    const invoiceA = await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId, studentId: pupilA.studentId } });
    await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${invoiceA.id}/pay`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ amount: "1000", method: "UPI" })
      .expect(200);

    // Staff sees everything, newest first, with totals.
    const all = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/payments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(all.body.data.total).toBe(1);
    expect(all.body.data.payments[0]).toMatchObject({ amount: "1000.00", method: "UPI", student: { id: pupilA.studentId } });

    // Pupil sees only their own; explicit other-student filter is denied.
    const mine = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/payments`)
      .set("Authorization", `Bearer ${pupilA.token}`)
      .expect(200);
    expect(mine.body.data.total).toBe(1);
    const empty = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/payments`)
      .set("Authorization", `Bearer ${pupilB.token}`)
      .expect(200);
    expect(empty.body.data.total).toBe(0);
    const denied = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/payments?studentId=${pupilA.studentId}`)
      .set("Authorization", `Bearer ${pupilB.token}`)
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");

    // Teacher holds no fees.read at all.
    const teacherToken = await loginAs(schoolId, slug, "TEACHER");
    const teacherDenied = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/payments`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(403);
    expect(teacherDenied.body.error.code).toBe("PERMISSION_DENIED");

    // Cross-tenant: other school sees nothing here.
    const schoolB = await registerSchool();
    const cross = await request(app)
      .get(`/api/v1/schools/${schoolId}/fees/payments`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(403);
    expect(cross.body.error.code).toBe("TENANT_MISMATCH");

    await request(app).get(`/api/v1/schools/${schoolId}/fees/payments`).expect(401);
  }, 30000);
});
