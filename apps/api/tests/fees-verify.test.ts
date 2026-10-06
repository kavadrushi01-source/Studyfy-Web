import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { fetchOrderPayments } from "../src/lib/razorpay.js";

// Mock ONLY the reconciliation read — pay-order creation, the webhook
// HMAC check, and the capture path all run real code. The mocked
// function answers what Razorpay "holds" for our order id.
vi.mock("../src/lib/razorpay.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/razorpay.js")>();
  return { ...actual, fetchOrderPayments: vi.fn(async () => []) };
});

const app = createApp();
const mockedFetch = vi.mocked(fetchOrderPayments);

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Verify School ${uid()}`,
      adminName: "Verify Admin",
      adminEmail: `verify-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeFamily(
  schoolId: string,
  slug: string,
): Promise<{ pupilToken: string; parentToken: string; studentId: string; invoiceId: string }> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const structure = await prisma.feeStructure.create({
    data: { schoolId, classId: cls.id, name: `Struct ${uid()}`, amount: "1200.00", term: "Term 1", category: "TUITION" },
  });
  const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
  const parentRole = await prisma.role.findUniqueOrThrow({ where: { name: "PARENT" } });
  const pupilEmail = `verify-pupil-${uid()}@example.com`;
  const pupil = await prisma.user.create({
    data: { schoolId, roleId: studentRole.id, email: pupilEmail, passwordHash: await bcrypt.hash("pupil-pass-123", 4), name: "Verify Pupil" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: pupil.id, sectionId: section.id } });
  const invoice = await prisma.feeInvoice.create({
    data: { schoolId, studentId: student.id, structureId: structure.id, amount: "1200.00", dueDate: new Date("2026-11-15T00:00:00Z") },
  });
  const parentEmail = `verify-parent-${uid()}@example.com`;
  const parent = await prisma.user.create({
    data: { schoolId, roleId: parentRole.id, email: parentEmail, passwordHash: await bcrypt.hash("parent-pass-123", 4), name: "Verify Parent" },
  });
  await prisma.studentGuardian.create({ data: { schoolId, studentId: student.id, parentId: parent.id, relationship: "Father" } });
  const pupilLogin = await request(app).post("/api/v1/auth/login").send({ email: pupilEmail, password: "pupil-pass-123", schoolSlug: slug }).expect(200);
  const parentLogin = await request(app).post("/api/v1/auth/login").send({ email: parentEmail, password: "parent-pass-123", schoolSlug: slug }).expect(200);
  return {
    pupilToken: pupilLogin.body.data.accessToken as string,
    parentToken: parentLogin.body.data.accessToken as string,
    studentId: student.id,
    invoiceId: invoice.id,
  };
}

async function pendingOrder(schoolId: string, invoiceId: string): Promise<string> {
  // The PENDING row pay-order would create — built directly so no test
  // ever touches the real gateway (fetchOrderPayments is the only mock).
  const orderId = `order_verify_${uid()}`;
  await prisma.feePayment.create({
    data: { schoolId, invoiceId, amount: "1200.00", method: "RAZORPAY", razorpayOrderId: orderId, status: "PENDING" },
  });
  return orderId;
}

describe("pay-verify fallback (§13.8: webhook loss recovery)", () => {
  it("applies a captured payment Razorpay holds but never webhooked", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const slug = (await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })).slug;
    const family = await makeFamily(schoolId, slug);
    const orderId = await pendingOrder(schoolId, family.invoiceId);

    // Razorpay holds a captured payment for our order; no webhook came.
    // (Payment id is unique per run: the test DB persists, and a fixed
    // fake id would read back as already-processed on reruns.)
    const gatewayPaymentId = `pay_verify_${uid()}`;
    // Persistent per-test mock (not Once-queue: early returns can skip a
    // fetch, and leftover queue entries bleed into the next test).
    mockedFetch.mockResolvedValue([{ id: gatewayPaymentId, amount: 120000, currency: "INR", status: "captured" }]);
    const verified = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/pay-verify`)
      .set("Authorization", `Bearer ${family.parentToken}`)
      .send({ orderId })
      .expect(200);
    expect(verified.body.data.status).toBe("CAPTURED");
    expect(verified.body.data.alreadyProcessed).toBe(false);

    const invoice = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: family.invoiceId } });
    expect(invoice.status).toBe("PAID");

    // Late webhook redelivery for the same payment is a no-op, not a
    // double credit — the shared capture path guarantees it.
    mockedFetch.mockResolvedValue([{ id: gatewayPaymentId, amount: 120000, currency: "INR", status: "captured" }]);
    const again = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/pay-verify`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderId })
      .expect(200);
    expect(again.body.data.alreadyProcessed).toBe(true);
    const after = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: family.invoiceId } });
    expect(after.amountPaid.toFixed(2)).toBe("1200.00");
  });

  it("stays PENDING when Razorpay holds nothing (poll again, never an error)", async () => {
    const { schoolId } = await registerSchool();
    const slug = (await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })).slug;
    const family = await makeFamily(schoolId, slug);
    const orderId = await pendingOrder(schoolId, family.invoiceId);

    mockedFetch.mockResolvedValue([]);
    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/pay-verify`)
      .set("Authorization", `Bearer ${family.parentToken}`)
      .send({ orderId })
      .expect(200);
    expect(res.body.data.status).toBe("PENDING");
    const invoice = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: family.invoiceId } });
    expect(invoice.status).not.toBe("PAID");
  });

  it("refuses strangers, pupils, and unknown orders", async () => {
    const school = await registerSchool();
    const slug = (await prisma.school.findUniqueOrThrow({ where: { id: school.schoolId } })).slug;
    const family = await makeFamily(school.schoolId, slug);
    const orderId = await pendingOrder(school.schoolId, family.invoiceId);

    // Another family's parent probes our order id → 403, never data.
    const stranger = await makeFamily(school.schoolId, slug);
    const denied = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/fees/pay-verify`)
      .set("Authorization", `Bearer ${stranger.parentToken}`)
      .send({ orderId })
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");

    // The pupil themselves cannot verify (parents + office only).
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/fees/pay-verify`)
      .set("Authorization", `Bearer ${family.pupilToken}`)
      .send({ orderId })
      .expect(403);

    // Unknown order → 404, never a blind flip.
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/fees/pay-verify`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ orderId: "order_nope123" })
      .expect(404);
  });
});
