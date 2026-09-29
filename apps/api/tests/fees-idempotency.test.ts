import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { findPaymentByProviderId } from "../src/modules/fees/fees.service.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Idempotency School ${uid()}`,
      adminName: "Idempotency Admin",
      adminEmail: `idempotency-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return { schoolId: res.body.data.school.id as string };
}

async function makeInvoice(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const structure = await prisma.feeStructure.create({
    data: { schoolId, classId: cls.id, name: `Struct ${uid()}`, amount: "15000.00", term: "Term 1", category: "TUITION" },
  });
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: `idem-student-${uid()}@example.com`,
      passwordHash: await bcrypt.hash("x", 4),
      name: "Idempotency Student",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId: section.id } });
  const invoice = await prisma.feeInvoice.create({
    data: {
      schoolId,
      studentId: student.id,
      structureId: structure.id,
      amount: "15000.00",
      dueDate: new Date("2026-10-15T00:00:00Z"),
    },
  });
  return invoice.id;
}

async function expectP2002(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (err) {
    expect((err as { code?: string }).code).toBe("P2002");
    return;
  }
  expect.unreachable("duplicate provider id must be rejected");
}

// §13.8 webhook foundation: the provider's order/payment IDs are the
// idempotency keys, and the lookup (not the payload) identifies the
// invoice + school. Provider ids are Razorpay-generated and unguessable,
// so this lookup needs no tenant filter — the returned schoolId is what
// the Phase 2 webhook will scope everything else by.
describe("fee provider-id idempotency (§13.8)", () => {
  it("manual counter payments (NULL provider ids) coexist and stay invisible to the lookup", async () => {
    const { schoolId } = await registerSchool();
    const invoiceId = await makeInvoice(schoolId);

    await prisma.feePayment.create({ data: { schoolId, invoiceId, amount: "5000.00", method: "CASH" } });
    await prisma.feePayment.create({ data: { schoolId, invoiceId, amount: "2500.00", method: "UPI" } });

    expect(await findPaymentByProviderId(prisma, {})).toBeNull();
    expect(await findPaymentByProviderId(prisma, { orderId: "order_missing" })).toBeNull();
    expect(await findPaymentByProviderId(prisma, { paymentId: "pay_missing" })).toBeNull();
  });

  it("an online payment resolves by order ID and by payment ID with its invoice + school", async () => {
    const { schoolId } = await registerSchool();
    const invoiceId = await makeInvoice(schoolId);

    const created = await prisma.feePayment.create({
      data: {
        schoolId,
        invoiceId,
        amount: "15000.00",
        method: "CARD",
        providerOrderId: `order_LIVE_${uid()}`,
        providerPaymentId: `pay_LIVE_${uid()}`,
      },
    });

    const byOrder = await findPaymentByProviderId(prisma, { orderId: created.providerOrderId ?? "" });
    expect(byOrder?.id).toBe(created.id);
    expect(byOrder?.invoiceId).toBe(invoiceId);
    expect(byOrder?.schoolId).toBe(schoolId);

    const byPayment = await findPaymentByProviderId(prisma, { paymentId: created.providerPaymentId ?? "" });
    expect(byPayment?.id).toBe(created.id);
    expect(byPayment?.invoiceId).toBe(invoiceId);
    expect(byPayment?.schoolId).toBe(schoolId);
  });

  it("duplicate provider order/payment ids are rejected so redelivery is a no-op", async () => {
    const { schoolId } = await registerSchool();
    const invoiceId = await makeInvoice(schoolId);
    const orderId = `order_DUP_${uid()}`;
    const paymentId = `pay_DUP_${uid()}`;

    await prisma.feePayment.create({
      data: { schoolId, invoiceId, amount: "15000.00", method: "CARD", providerOrderId: orderId, providerPaymentId: paymentId },
    });

    // Same payment id delivered twice (the classic redelivery).
    await expectP2002(() =>
      prisma.feePayment.create({
        data: { schoolId, invoiceId, amount: "15000.00", method: "CARD", providerOrderId: orderId, providerPaymentId: paymentId },
      }),
    );

    // Same order, different payment id (failed attempt recorded after success).
    await expectP2002(() =>
      prisma.feePayment.create({
        data: { schoolId, invoiceId, amount: "15000.00", method: "CARD", providerOrderId: orderId, providerPaymentId: `pay_OTHER_${uid()}` },
      }),
    );

    expect(await prisma.feePayment.count({ where: { providerOrderId: orderId } })).toBe(1);
  });
});
