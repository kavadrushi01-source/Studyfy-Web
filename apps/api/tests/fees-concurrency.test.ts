import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { recordOnlineCapture, recordPayment } from "../src/modules/fees/fees.service.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminEmail: string }> {
  const adminEmail = `race-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Race School ${uid()}`,
      adminName: "Race Admin",
      adminEmail,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminEmail,
  };
}

async function makeInvoice(schoolId: string, amount: string): Promise<{ invoiceId: string; studentId: string }> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const structure = await prisma.feeStructure.create({
    data: { schoolId, classId: cls.id, name: `Struct ${uid()}`, amount, term: "Term 1", category: "TUITION" },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: `race-pupil-${uid()}@example.com`,
      passwordHash: await bcrypt.hash("x", 4),
      name: "Race Pupil",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId: section.id } });
  const invoice = await prisma.feeInvoice.create({
    data: {
      schoolId,
      studentId: student.id,
      structureId: structure.id,
      amount,
      dueDate: new Date("2026-11-15T00:00:00Z"),
    },
  });
  return { invoiceId: invoice.id, studentId: student.id };
}

async function moveBalanceAfterSnapshot(schoolId: string, invoiceId: string, receivedById: string): Promise<void> {
  await prisma.feePayment.create({
    data: { schoolId, invoiceId, amount: "4000.00", method: "CASH", receivedById },
  });
  await prisma.feeInvoice.update({
    where: { id: invoiceId },
    data: { amountPaid: "4000.00", status: "PARTIAL" },
  });
}

async function widenInvoiceAfterSnapshot(schoolId: string, invoiceId: string, receivedById: string): Promise<void> {
  await prisma.feePayment.create({
    data: { schoolId, invoiceId, amount: "4000.00", method: "CASH", receivedById },
  });
  await prisma.feeInvoice.update({
    where: { id: invoiceId },
    data: { amount: "14000.00", amountPaid: "4000.00", status: "PARTIAL" },
  });
}

async function paymentTotal(invoiceId: string): Promise<number> {
  const rows = await prisma.feePayment.findMany({ where: { invoiceId } });
  return rows.reduce((sum, row) => sum + Number(row.amount), 0);
}

// A concurrent recorder moves the balance after this call reads it. The
// implementation must retry against the moved snapshot instead of blindly
// overwriting it — otherwise one of the two 4000 payments vanishes.
describe("concurrent fee payments never lose an update (BUGSFIX-62)", () => {
  it("retries a counter payment against a balance moved after its read", async () => {
    const { schoolId } = await registerSchool();
    const { invoiceId } = await makeInvoice(schoolId, "10000.00");
    const admin = await prisma.user.findFirstOrThrow({ where: { schoolId, email: { contains: "race-admin-" } } });
    const realFind = prisma.feeInvoice.findFirst.bind(prisma.feeInvoice);
    const findSpy = vi.spyOn(prisma.feeInvoice, "findFirst").mockImplementationOnce(((args) =>
      realFind(args).then(async (snapshot) => {
        await moveBalanceAfterSnapshot(schoolId, invoiceId, admin.id);
        return snapshot;
      })) as typeof prisma.feeInvoice.findFirst);

    try {
      const result = await recordPayment(prisma, invoiceId, admin.id, { amount: "4000.00", method: "CASH" });
      expect(result.invoice.status).toBe("PARTIAL");
      expect(Number(result.invoice.amountPaid)).toBe(8000);
      expect(Number(result.payment.amount)).toBe(4000);
    } finally {
      findSpy.mockRestore();
    }

    const refreshed = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(Number(refreshed.amountPaid)).toBe(8000);
    expect(await paymentTotal(invoiceId)).toBe(8000);
    const audits = await prisma.auditLog.findMany({
      where: { schoolId, action: "PAYMENT_RECORDED", entity: "FeeInvoice", entityId: invoiceId },
    });
    expect(audits).toHaveLength(1);
    expect(Number((audits[0]?.before as { amountPaid?: string } | null)?.amountPaid)).toBe(4000);
    expect(Number((audits[0]?.after as { amountPaid?: string } | null)?.amountPaid)).toBe(8000);
  });

  it("retries an online capture against a balance moved after its read", async () => {
    const { schoolId } = await registerSchool();
    const { invoiceId } = await makeInvoice(schoolId, "10000.00");
    const admin = await prisma.user.findFirstOrThrow({ where: { schoolId, email: { contains: "race-admin-" } } });
    const orderId = `order_RACE_${uid()}`;
    const paymentId = `pay_RACE_${uid()}`;
    await prisma.feePayment.create({
      data: { schoolId, invoiceId, amount: "10000.00", method: "RAZORPAY", razorpayOrderId: orderId, status: "PENDING" },
    });
    const realFind = prisma.feeInvoice.findFirst.bind(prisma.feeInvoice);
    const realTransaction = prisma.$transaction.bind(prisma);
    const findSpy = vi.spyOn(prisma.feeInvoice, "findFirst").mockImplementationOnce(((args) => {
      const snapshot = realFind(args);
      const moved = snapshot.then(async () => {
        await widenInvoiceAfterSnapshot(schoolId, invoiceId, admin.id);
      });
      const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce((async (callback: Parameters<typeof prisma.$transaction>[0]) => {
        await moved;
        try {
          return await realTransaction(callback);
        } finally {
          transactionSpy.mockRestore();
        }
      }) as typeof prisma.$transaction);
      return snapshot;
    }) as typeof prisma.feeInvoice.findFirst);

    try {
      const result = await recordOnlineCapture(prisma, { razorpayOrderId: orderId, razorpayPaymentId: paymentId, amountPaise: 1000000 }, null);
      expect(result.alreadyProcessed).toBe(false);
      expect(result.status).toBe("CAPTURED");
    } finally {
      findSpy.mockRestore();
    }

    const refreshed = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(refreshed.status).toBe("PAID");
    expect(Number(refreshed.amount)).toBe(14000);
    expect(Number(refreshed.amountPaid)).toBe(14000);
    expect(await paymentTotal(invoiceId)).toBe(14000);
    const audits = await prisma.auditLog.findMany({
      where: { schoolId, action: "PAYMENT_CAPTURED", entity: "FeeInvoice", entityId: invoiceId },
    });
    expect(audits).toHaveLength(1);
    expect(Number((audits[0]?.before as { amount?: string; amountPaid?: string } | null)?.amount)).toBe(14000);
    expect(Number((audits[0]?.before as { amountPaid?: string } | null)?.amountPaid)).toBe(4000);
    expect(Number((audits[0]?.after as { amountPaid?: string } | null)?.amountPaid)).toBe(14000);
  });
});
