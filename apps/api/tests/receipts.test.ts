import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { generateFeeReceipt } from "../src/lib/receipt.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Receipt School ${uid()}`,
      adminName: "Receipt Admin",
      adminEmail: `receipt-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function paidInvoice(
  schoolId: string,
  adminToken: string,
): Promise<string> {
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
      email: `receipt-student-${uid()}@example.com`,
      passwordHash: "x",
      name: "Receipt Student",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId: section.id } });
  const structure = await request(app)
    .post(`/api/v1/schools/${schoolId}/fees/structures`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ classId: cls.id, name: "Term 1 Tuition", amount: "5000", term: "Term 1", category: "TUITION" })
    .expect(201);
  await request(app)
    .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ structureId: structure.body.data.structure.id as string, sectionId: section.id, dueDate: "2026-11-15" })
    .expect(201);
  const invoice = await prisma.feeInvoice.findFirst({ where: { schoolId, studentId: student.id } });
  if (!invoice) {
    throw new Error("Invoice was not generated");
  }
  const pay = await request(app)
    .post(`/api/v1/schools/${schoolId}/fees/invoices/${invoice.id}/pay`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ amount: "2000", method: "CASH" })
    .expect(200);
  return pay.body.data.payment.id as string;
}

async function loginAs(schoolId: string, slug: string, roleName: string): Promise<string> {
  const email = `receipt-${roleName.toLowerCase()}-${uid()}@example.com`;
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

describe("fee receipt PDF (§7 Phase 1 #3, §8.5)", () => {
  it("renders a complete PDF document", async () => {
    const pdf = await generateFeeReceipt({
      schoolName: "Receipt School",
      brandColor: "#2563EB",
      receiptNo: "ABC12345",
      studentName: "Receipt Student",
      structureName: "Term 1 Tuition",
      invoiceAmount: "5000",
      paidNow: "2000",
      totalPaid: "2000",
      balance: "3000",
      status: "PARTIAL",
      method: "CASH",
      paidAt: new Date("2026-09-17T00:00:00Z"),
      receivedBy: "Counter Admin",
    });
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf.length).toBeGreaterThan(1024);
  });

  it("serves the receipt to staff, blocks teachers/foreigners/anonymous", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const paymentId = await paidInvoice(schoolA.schoolId, schoolA.adminToken);
    const teacherToken = await loginAs(schoolA.schoolId, schoolA.slug, "TEACHER");

    const ok = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/fees/payments/${paymentId}/receipt`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .expect(200);
    expect(ok.headers["content-type"]).toContain("application/pdf");

    const teacher = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/fees/payments/${paymentId}/receipt`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(403);
    expect(teacher.body.error.code).toBe("PERMISSION_DENIED");

    const foreign = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/fees/payments/${paymentId}/receipt`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(404);
    expect(foreign.body.error.code).toBe("NOT_FOUND");

    await request(app).get(`/api/v1/schools/${schoolA.schoolId}/fees/payments/${paymentId}/receipt`).expect(401);
  });
});
