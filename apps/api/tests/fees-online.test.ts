import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createRazorpayOrder, razorpayKeys } from "../src/lib/razorpay.js";

// Mock ONLY the gateway call — the real key guard (missing/live keys)
// stays live via importOriginal so the guard tests exercise actual code.
vi.mock("../src/lib/razorpay.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/razorpay.js")>();
  return {
    ...actual,
    createRazorpayOrder: vi.fn(async (amountPaise: number, receipt: string) => ({
      id: `order_TEST_${randomUUID().slice(0, 8)}`,
      amount: amountPaise,
      currency: "INR",
      receipt,
      status: "created",
      keyId: "rzp_test_fake",
    })),
  };
});

const app = createApp();
const mockedOrder = vi.mocked(createRazorpayOrder);

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Online School ${uid()}`,
      adminName: "Online Admin",
      adminEmail: `online-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeInvoice(
  schoolId: string,
  studentName: string,
): Promise<{ invoiceId: string; studentId: string; pupilEmail: string }> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const structure = await prisma.feeStructure.create({
    data: { schoolId, classId: cls.id, name: `Struct ${uid()}`, amount: "15000.00", term: "Term 1", category: "TUITION" },
  });
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const pupilEmail = `online-pupil-${uid()}@example.com`;
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: pupilEmail,
      passwordHash: await bcrypt.hash("pupil-pass-123", 4),
      name: studentName,
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
  return { invoiceId: invoice.id, studentId: student.id, pupilEmail };
}

async function loginAs(email: string, password: string, slug: string): Promise<string> {
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

async function linkGuardian(schoolId: string, slug: string, studentId: string): Promise<string> {
  const role = await prisma.role.findUnique({ where: { name: "PARENT" } });
  if (!role) {
    throw new Error("PARENT role must be seeded");
  }
  const email = `online-parent-${uid()}@example.com`;
  const password = "user-pass-123";
  const parent = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Online Parent" },
  });
  await prisma.studentGuardian.create({ data: { schoolId, studentId, parentId: parent.id, relationship: "Father" } });
  return loginAs(email, password, slug);
}

// POST /schools/:schoolId/fees/invoices/:invoiceId/pay-order (§13.8):
// frontend sends ONLY the invoice id; the server recomputes everything.
describe("POST pay-order (online initiation, §13.8)", () => {
  it("parent initiates for own child: server-computed amount, PENDING row, tampered body ignored", async () => {
    const { schoolId, slug } = await registerSchool();
    const { invoiceId, studentId } = await makeInvoice(schoolId, "Own Child");
    const parentToken = await linkGuardian(schoolId, slug, studentId);
    mockedOrder.mockClear();

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${invoiceId}/pay-order`)
      .set("Authorization", `Bearer ${parentToken}`)
      .send({ amount: "1.00" })
      .expect(201);
    // Tampered 1.00 ignored: the real outstanding (15000.00) wins.
    expect(res.body.data.amount).toBe("15000.00");
    expect(res.body.data.currency).toBe("INR");
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.invoiceId).toBe(invoiceId);
    expect(mockedOrder).toHaveBeenCalledOnce();
    const call = mockedOrder.mock.calls[0];
    expect(call?.[0]).toBe(1500000);
    expect(call?.[1]).toBe(invoiceId);

    const row = await prisma.feePayment.findFirst({ where: { razorpayOrderId: res.body.data.orderId as string } });
    expect(row?.status).toBe("PENDING");
    expect(row?.method).toBe("RAZORPAY");
    expect(Number(row?.amount)).toBe(15000);
  });

  it("parent is refused another family's invoice", async () => {
    const { schoolId, slug } = await registerSchool();
    const own = await makeInvoice(schoolId, "Own Child");
    const stranger = await makeInvoice(schoolId, "Stranger Child");
    const parentToken = await linkGuardian(schoolId, slug, own.studentId);

    const denied = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${stranger.invoiceId}/pay-order`)
      .set("Authorization", `Bearer ${parentToken}`)
      .send({})
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
  });

  it("student initiates for self but not for a stranger; admin may initiate for anyone", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const own = await makeInvoice(schoolId, "Self Pupil");
    const stranger = await makeInvoice(schoolId, "Other Pupil");
    const pupilToken = await loginAs(own.pupilEmail, "pupil-pass-123", slug);

    await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${own.invoiceId}/pay-order`)
      .set("Authorization", `Bearer ${pupilToken}`)
      .send({})
      .expect(201);

    const refused = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${stranger.invoiceId}/pay-order`)
      .set("Authorization", `Bearer ${pupilToken}`)
      .send({})
      .expect(403);
    expect(refused.body.error.code).toBe("FORBIDDEN");

    await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${stranger.invoiceId}/pay-order`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({})
      .expect(201);
  });

  it("settled and unknown invoices are rejected", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const { invoiceId } = await makeInvoice(schoolId, "Settled Pupil");
    await prisma.feeInvoice.update({ where: { id: invoiceId }, data: { status: "PAID", amountPaid: "15000.00" } });

    const settled = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/${invoiceId}/pay-order`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({})
      .expect(409);
    expect(settled.body.error.code).toBe("INVOICE_SETTLED");

    const missing = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/invoices/does-not-exist/pay-order`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({})
      .expect(404);
    expect(missing.body.error.code).toBe("INVOICE_NOT_FOUND");
  });

  it("missing keys → 503, live-prefixed key → 500 (guard is real, not mocked)", async () => {
    // The HTTP path above exercises the mocked gateway; here the REAL
    // guard runs directly (it lives in the same module, preserved by
    // importOriginal). In production the service calls it first, so a
    // missing/misconfigured key fails before any gateway traffic.
    const savedId = process.env.RAZORPAY_KEY_ID;
    const savedSecret = process.env.RAZORPAY_KEY_SECRET;
    try {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      try {
        razorpayKeys();
        expect.unreachable("missing keys must throw");
      } catch (err) {
        expect((err as { code?: string }).code).toBe("PAYMENTS_UNCONFIGURED");
      }

      process.env.RAZORPAY_KEY_ID = "rzp_live_fake";
      process.env.RAZORPAY_KEY_SECRET = "live-secret";
      try {
        razorpayKeys();
        expect.unreachable("live key must throw");
      } catch (err) {
        expect((err as { code?: string }).code).toBe("PAYMENTS_MISCONFIGURED");
      }

      process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
      process.env.RAZORPAY_KEY_SECRET = "test-secret";
      expect(razorpayKeys()).toEqual({ keyId: "rzp_test_fake", keySecret: "test-secret" });
    } finally {
      if (savedId === undefined) {
        delete process.env.RAZORPAY_KEY_ID;
      } else {
        process.env.RAZORPAY_KEY_ID = savedId;
      }
      if (savedSecret === undefined) {
        delete process.env.RAZORPAY_KEY_SECRET;
      } else {
        process.env.RAZORPAY_KEY_SECRET = savedSecret;
      }
    }
  });
});
