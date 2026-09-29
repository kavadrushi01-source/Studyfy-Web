import bcrypt from "bcryptjs";
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

// Fixed webhook secret for this file (restored after): signatures are
// computed over the exact bytes supertest sends.
const SAVED_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = "wh-test-secret";
afterAll(() => {
  if (SAVED_WEBHOOK_SECRET === undefined) {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  } else {
    process.env.RAZORPAY_WEBHOOK_SECRET = SAVED_WEBHOOK_SECRET;
  }
});

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

function sign(body: unknown): string {
  return createHmac("sha256", "wh-test-secret").update(JSON.stringify(body)).digest("hex");
}

async function registerSchool(): Promise<{ schoolId: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Webhook School ${uid()}`,
      adminName: "Webhook Admin",
      adminEmail: `webhook-admin-${uid()}@example.com`,
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
      email: `webhook-pupil-${uid()}@example.com`,
      passwordHash: await bcrypt.hash("x", 4),
      name: "Webhook Pupil",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId: section.id } });
  const invoice = await prisma.feeInvoice.create({
    data: {
      schoolId,
      studentId: student.id,
      structureId: structure.id,
      amount: "15000.00",
      dueDate: new Date("2026-11-15T00:00:00Z"),
    },
  });
  return invoice.id;
}

async function makePendingRow(
  schoolId: string,
  invoiceId: string,
  orderId: string,
): Promise<void> {
  await prisma.feePayment.create({
    data: {
      schoolId,
      invoiceId,
      amount: "15000.00",
      method: "RAZORPAY",
      razorpayOrderId: orderId,
      status: "PENDING",
    },
  });
}

function capturedPayload(orderId: string, paymentId: string, amountPaise: number): Record<string, unknown> {
  return {
    event: "payment.captured",
    // Decoy ids a tampered payload might carry: the handler must ignore
    // all of them and resolve purely through the order id.
    school_id: "evil-school",
    invoice_id: "evil-invoice",
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount: amountPaise,
          currency: "INR",
          status: "captured",
        },
      },
    },
  };
}

// POST /api/v1/payments/webhook (§13.8): signature first, order-id lookup
// second, idempotency always. No auth/token of any kind rides along.
describe("POST /api/v1/payments/webhook (§13.8)", () => {
  it("records a capture once even when the same payload arrives twice", async () => {
    const { schoolId } = await registerSchool();
    const invoiceId = await makeInvoice(schoolId);
    const orderId = `order_HOOK_${uid()}`;
    const paymentId = `pay_HOOK_${uid()}`;
    await makePendingRow(schoolId, invoiceId, orderId);
    const body = capturedPayload(orderId, paymentId, 1500000);
    const signature = sign(body);

    const first = await request(app)
      .post("/api/v1/payments/webhook")
      .set("x-razorpay-signature", signature)
      .send(body)
      .expect(200);
    expect(first.body.data.alreadyProcessed).toBe(false);
    expect(first.body.data.invoiceId).toBe(invoiceId);

    const second = await request(app)
      .post("/api/v1/payments/webhook")
      .set("x-razorpay-signature", signature)
      .send(body)
      .expect(200);
    expect(second.body.data.alreadyProcessed).toBe(true);
    expect(second.body.data.paymentId).toBe(first.body.data.paymentId);

    // Exactly one payment row, credited exactly once.
    expect(await prisma.feePayment.count({ where: { razorpayPaymentId: paymentId } })).toBe(1);
    const invoice = await prisma.feeInvoice.findUnique({ where: { id: invoiceId } });
    expect(invoice?.status).toBe("PAID");
    expect(Number(invoice?.amountPaid)).toBe(15000);
    const payment = await prisma.feePayment.findFirst({ where: { razorpayOrderId: orderId } });
    expect(payment?.status).toBe("CAPTURED");
  });

  it("rejects bad signatures without touching anything", async () => {
    const { schoolId } = await registerSchool();
    const invoiceId = await makeInvoice(schoolId);
    const orderId = `order_BADMAC_${uid()}`;
    await makePendingRow(schoolId, invoiceId, orderId);
    const body = capturedPayload(orderId, `pay_BADMAC_${uid()}`, 1500000);

    const res = await request(app)
      .post("/api/v1/payments/webhook")
      .set("x-razorpay-signature", "deadbeef")
      .send(body)
      .expect(401);
    expect(res.body.error.code).toBe("WEBHOOK_UNAUTHORIZED");

    const invoice = await prisma.feeInvoice.findUnique({ where: { id: invoiceId } });
    expect(invoice?.status).toBe("PENDING");
    expect(Number(invoice?.amountPaid)).toBe(0);
  });

  it("404s unknown orders and refuses amount mismatches", async () => {
    const { schoolId } = await registerSchool();
    const invoiceId = await makeInvoice(schoolId);
    const orderId = `order_MISM_${uid()}`;
    await makePendingRow(schoolId, invoiceId, orderId);

    const unknown = capturedPayload(`order_NOPE_${uid()}`, `pay_NOPE_${uid()}`, 1500000);
    const unknownRes = await request(app)
      .post("/api/v1/payments/webhook")
      .set("x-razorpay-signature", sign(unknown))
      .send(unknown)
      .expect(404);
    expect(unknownRes.body.error.code).toBe("ORDER_NOT_FOUND");

    // Half the outstanding: refused, nothing recorded.
    const short = capturedPayload(orderId, `pay_SHORT_${uid()}`, 750000);
    const shortRes = await request(app)
      .post("/api/v1/payments/webhook")
      .set("x-razorpay-signature", sign(short))
      .send(short)
      .expect(400);
    expect(shortRes.body.error.code).toBe("AMOUNT_MISMATCH");
    expect(await prisma.feePayment.count({ where: { razorpayOrderId: orderId } })).toBe(1);
    const invoice = await prisma.feeInvoice.findUnique({ where: { id: invoiceId } });
    expect(invoice?.status).toBe("PENDING");
  });

  it("acknowledges non-capture events without recording", async () => {
    const { schoolId } = await registerSchool();
    const invoiceId = await makeInvoice(schoolId);
    const orderId = `order_EVT_${uid()}`;
    await makePendingRow(schoolId, invoiceId, orderId);
    const body = { event: "payment.failed", payload: { payment: { entity: { id: `pay_EVT_${uid()}`, order_id: orderId } } } };

    const res = await request(app)
      .post("/api/v1/payments/webhook")
      .set("x-razorpay-signature", sign(body))
      .send(body)
      .expect(200);
    expect(res.body.data.ignored).toBe("payment.failed");
    expect(await prisma.feePayment.count({ where: { razorpayOrderId: orderId } })).toBe(1);
  });

  it("needs the webhook secret configured, or fails closed", async () => {
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    try {
      const body = capturedPayload(`order_UNCONF_${uid()}`, `pay_UNCONF_${uid()}`, 1500000);
      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("x-razorpay-signature", sign(body))
        .send(body)
        .expect(503);
      expect(res.body.error.code).toBe("PAYMENTS_UNCONFIGURED");
    } finally {
      if (saved !== undefined) {
        process.env.RAZORPAY_WEBHOOK_SECRET = saved;
      }
    }
  });
});
