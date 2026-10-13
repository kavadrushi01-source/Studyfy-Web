import bcrypt from "bcryptjs";
import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { createRazorpayOrder, fetchOrderPayments } from "../src/lib/razorpay.js";

// Mock ONLY the gateway calls — key guards stay live via importOriginal.
vi.mock("../src/lib/razorpay.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/razorpay.js")>();
  return {
    ...actual,
    createRazorpayOrder: vi.fn(async (amountPaise: number, receipt: string) => ({
      id: `order_SUB_${randomUUID().slice(0, 8)}`,
      amount: amountPaise,
      currency: "INR",
      receipt,
      status: "created",
      keyId: "rzp_test_fake",
    })),
    fetchOrderPayments: vi.fn(async () => []),
  };
});

const app = createApp();
const mockedOrder = vi.mocked(createRazorpayOrder);
const mockedFetch = vi.mocked(fetchOrderPayments);

process.env.RAZORPAY_WEBHOOK_SECRET = "wh-billing-secret";

function uid(): string {
  return randomUUID().slice(0, 8);
}

function sign(body: unknown): string {
  return createHmac("sha256", "wh-billing-secret").update(JSON.stringify(body)).digest("hex");
}

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string; adminId: string; adminEmail: string }> {
  const adminEmail = `billing-online-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Billing Online Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: adminEmail } } });
  return { schoolId, slug: res.body.data.school.slug as string, adminToken: res.body.data.accessToken as string, adminId: admin.id, adminEmail };
}

async function loginOwner(): Promise<string> {
  const email = `billing-online-owner-${uid()}@example.com`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
  await prisma.user.create({
    data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Billing Online Owner" },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
  return res.body.data.accessToken as string;
}

async function makeTeacher(schoolId: string): Promise<string> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
  const email = `billing-online-teacher-${uid()}@example.com`;
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash("teacher-pass-123", 4), name: "Billing Teacher" },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: "teacher-pass-123", schoolSlug: (await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })).slug })
    .expect(200);
  return login.body.data.accessToken as string;
}

async function issueInvoice(
  ownerToken: string,
  schoolId: string,
  plan: "BASIC" | "STANDARD" = "BASIC",
  periodStart = "2026-11-01",
  periodEnd = "2026-11-30",
): Promise<{ id: string; invoiceNumber: string }> {
  const res = await request(app)
    .post("/api/v1/platform/subscription-invoices")
    .set({ Authorization: `Bearer ${ownerToken}` })
    .send({ schoolId, plan, periodStart, periodEnd })
    .expect(201);
  return { id: res.body.data.invoice.id as string, invoiceNumber: res.body.data.invoice.invoiceNumber as string };
}

describe("subscription pay-order (§16.1, admin-only, server-computed)", () => {
  it(
    "creates a real test order for the exact GST-inclusive total; refusals all around it",
    { timeout: 120000 },
    async () => {
      const school = await registerSchool(`Billing Order School ${uid()}`);
      const ownerToken = await loginOwner();
      const { id: invoiceId } = await issueInvoice(ownerToken, school.schoolId, "BASIC");
      const auth = { Authorization: `Bearer ${school.adminToken}` };

      const order = await request(app)
        .post(`/api/v1/schools/${school.schoolId}/billing/invoices/${invoiceId}/pay-order`)
        .set(auth)
        .expect(201);
      // 299900 + 18% (53982) = 353882 paise → ₹3538.82. Tampering is
      // structural: the body carries no amount at all.
      expect(order.body.data.amount).toBe("3538.82");
      expect(order.body.data.keyId).toBe("rzp_test_fake");
      expect(mockedOrder).toHaveBeenCalledWith(353882, expect.any(String), expect.anything());
      const stored = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(stored.razorpayOrderId).toBe(order.body.data.orderId as string);

      // Teacher (no billing key), unknown invoice, and paid invoice refuse.
      const teacherToken = await makeTeacher(school.schoolId);
      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/billing/invoices/${invoiceId}/pay-order`)
        .set({ Authorization: `Bearer ${teacherToken}` })
        .expect(403);
      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/billing/invoices/nope/pay-order`)
        .set(auth)
        .expect(404);
      await prisma.subscriptionInvoice.update({ where: { id: invoiceId }, data: { status: "PAID" } });
      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/billing/invoices/${invoiceId}/pay-order`)
        .set(auth)
        .expect(409);
    },
  );
});

describe("subscription webhook capture (§16.1 shared order flow)", () => {
  it(
    "captures once on redelivery, NULL actor, activates subscription + mirror + audits",
    { timeout: 120000 },
    async () => {
      const school = await registerSchool(`Billing Webhook School ${uid()}`);
      const ownerToken = await loginOwner();
      const { id: invoiceId } = await issueInvoice(ownerToken, school.schoolId, "BASIC");
      const orderId = `order_SUBWH_${uid()}`;
      const paymentId = `pay_SUBWH_${uid()}`;
      await prisma.subscriptionInvoice.update({ where: { id: invoiceId }, data: { razorpayOrderId: orderId } });
      const body = {
        event: "payment.captured",
        payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: 353882, currency: "INR", status: "captured" } } },
      };
      const signature = sign(body);

      const first = await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", signature).send(body).expect(200);
      expect(first.body.data.kind).toBe("subscription");
      expect(first.body.data.alreadyProcessed).toBe(false);
      expect(first.body.data.invoiceId).toBe(invoiceId);

      const second = await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", signature).send(body).expect(200);
      expect(second.body.data.alreadyProcessed).toBe(true);
      expect(await prisma.subscriptionInvoice.count({ where: { razorpayPaymentId: paymentId } })).toBe(1);

      const invoice = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
      expect(invoice.status).toBe("PAID");
      expect(invoice.paidMethod).toBe("RAZORPAY");
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { schoolId: school.schoolId } });
      expect(sub.status).toBe("ACTIVE");
      expect((await prisma.school.findUniqueOrThrow({ where: { id: school.schoolId } })).subscriptionStatus).toBe("ACTIVE");

      const rows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "SUBSCRIPTION_INVOICE_PAID" } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actorId).toBeNull();
      expect(rows[0]?.after).toMatchObject({ status: "PAID", paidMethod: "RAZORPAY" });
    },
  );

  it("refuses amount mismatch and unknown orders", async () => {
    const school = await registerSchool(`Billing Mismatch School ${uid()}`);
    const ownerToken = await loginOwner();
    const { id: invoiceId } = await issueInvoice(ownerToken, school.schoolId, "BASIC");
    const orderId = `order_SUBMM_${uid()}`;
    await prisma.subscriptionInvoice.update({ where: { id: invoiceId }, data: { razorpayOrderId: orderId } });
    const badBody = {
      event: "payment.captured",
      payload: { payment: { entity: { id: `pay_SUBMM_${uid()}`, order_id: orderId, amount: 100, currency: "INR", status: "captured" } } },
    };
    const bad = await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", sign(badBody)).send(badBody);
    expect(bad.status).toBe(400);

    const unknownBody = {
      event: "payment.captured",
      payload: { payment: { entity: { id: `pay_SUBUK_${uid()}`, order_id: `order_UNKNOWN_${uid()}`, amount: 100, currency: "INR", status: "captured" } } },
    };
    const unknown = await request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", sign(unknownBody)).send(unknownBody);
    expect(unknown.status).toBe(404);
  });
});

describe("subscription payment refusals (§16.1, both directions)", () => {
  it(
    "a teacher can neither pay nor mark paid; an admin cannot pay another school's invoice",
    { timeout: 120000 },
    async () => {
      const a = await registerSchool(`Billing Refuse A ${uid()}`);
      const b = await registerSchool(`Billing Refuse B ${uid()}`);
      const ownerToken = await loginOwner();
      const { id: aInvoice } = await issueInvoice(ownerToken, a.schoolId, "BASIC");
      const { id: bInvoice } = await issueInvoice(ownerToken, b.schoolId, "BASIC");
      const teacherToken = await makeTeacher(a.schoolId);

      // Teacher on the owner mark-paid route: platform-only, 403.
      const teacherMark = await request(app)
        .post(`/api/v1/platform/subscription-invoices/${aInvoice}/mark-paid`)
        .set({ Authorization: `Bearer ${teacherToken}` });
      expect(teacherMark.status).toBe(403);

      // Teacher on pay-order: already refused (§16.1 test above) — and the
      // invoice stays PENDING either way.
      expect((await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: aInvoice } })).status).toBe("PENDING");

      // Admin of A paying B's invoice: the tenant-scoped lookup finds no
      // such invoice for A's school — 404, never cross-tenant.
      const cross = await request(app)
        .post(`/api/v1/schools/${a.schoolId}/billing/invoices/${bInvoice}/pay-order`)
        .set({ Authorization: `Bearer ${a.adminToken}` });
      expect(cross.status).toBe(404);

      // Own invoice still payable afterwards (refusals changed nothing).
      const own = await request(app)
        .post(`/api/v1/schools/${a.schoolId}/billing/invoices/${aInvoice}/pay-order`)
        .set({ Authorization: `Bearer ${a.adminToken}` })
        .expect(201);
      expect(own.body.data.orderId as string).toMatch(/^order_/);
    },
  );
});

describe("subscription pay-verify (§13.8 fallback shape)", () => {
  it("applies a gateway-held capture with the admin as actor, PENDING otherwise", async () => {
    const school = await registerSchool(`Billing Verify School ${uid()}`);
    const ownerToken = await loginOwner();
    const { id: invoiceId } = await issueInvoice(ownerToken, school.schoolId, "BASIC");
    const orderId = `order_SUBVF_${uid()}`;
    const paymentId = `pay_SUBVF_${uid()}`;
    await prisma.subscriptionInvoice.update({ where: { id: invoiceId }, data: { razorpayOrderId: orderId } });
    const auth = { Authorization: `Bearer ${school.adminToken}` };

    mockedFetch.mockResolvedValueOnce([{ id: paymentId, amount: 353882, currency: "INR", status: "captured" }]);
    const applied = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/billing/pay-verify`)
      .set(auth)
      .send({ orderId })
      .expect(200);
    expect(applied.body.data.status).toBe("PAID");
    const rows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "SUBSCRIPTION_INVOICE_PAID" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(school.adminId);

    // Nothing held → PENDING, never an error or a flip. (December period:
    // issuance is period-keyed, so this is a genuinely new invoice.)
    const orderId2 = `order_SUBVF2_${uid()}`;
    const { id: invoiceId2 } = await issueInvoice(ownerToken, school.schoolId, "BASIC", "2026-12-01", "2026-12-31");
    await prisma.subscriptionInvoice.update({ where: { id: invoiceId2 }, data: { razorpayOrderId: orderId2 } });
    mockedFetch.mockResolvedValueOnce([]);
    const pending = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/billing/pay-verify`)
      .set(auth)
      .send({ orderId: orderId2 })
      .expect(200);
    expect(pending.body.data.status).toBe("PENDING");

    const unknown = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/billing/pay-verify`)
      .set(auth)
      .send({ orderId: `order_NOPE_${uid()}` });
    expect(unknown.status).toBe(404);
  });
});

describe("billing overview (§13.4 exception surface)", () => {
  it("serves the suspended admin the full billing picture", async () => {
    const school = await registerSchool(`Billing Overview School ${uid()}`);
    const ownerToken = await loginOwner();
    await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/suspend`)
      .set({ Authorization: `Bearer ${ownerToken}` })
      .send({ reason: "Test suspension" })
      .expect(200);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ schoolSlug: school.slug, email: `billing-overview-does-not-matter@example.com`, password: "x" });
    expect(login.status).toBe(401);

    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ schoolSlug: school.slug, email: school.adminEmail, password: "password-123" })
      .expect(200);
    const res = await request(app)
      .get(`/api/v1/schools/${school.schoolId}/billing/overview`)
      .set({ Authorization: `Bearer ${adminLogin.body.data.accessToken as string}` })
      .expect(200);
    expect(res.body.data.school.subscriptionStatus).toBe("SUSPENDED");
    // Tenant-root reads are never extension-pinned (School has no
    // schoolId column) — assert the row is OURS, not another school's. A
    // bare findFirst here once returned a stranger row (caught live).
    expect(res.body.data.school.id).toBe(school.schoolId);
    expect(res.body.data.plans.PREMIUM.pricePaise).toBe(999900);
    expect(res.body.data.effectivePlan).toBe("BASIC");
  });

  it("reports student usage against the effective cap", async () => {
    const school = await registerSchool(`Billing Usage School ${uid()}`);
    const res = await request(app)
      .get(`/api/v1/schools/${school.schoolId}/billing/overview`)
      .set({ Authorization: `Bearer ${school.adminToken}` })
      .expect(200);
    // Fresh trial school: Standard tier via effectivePlan, no pupils yet.
    expect(res.body.data.usage).toEqual({ enrolled: 0, cap: 1500 });
    expect(res.body.data.effectivePlan).toBe("STANDARD");
  });
});
