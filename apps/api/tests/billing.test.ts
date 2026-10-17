import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import {
  addDays,
  computeGst,
  financialYear,
  invoiceNumberFor,
  issueInvoice,
  markInvoicePaid,
  recordSubscriptionCapture,
  runBillingCycle,
  schoolAccess,
  setSubscription,
  startOfDayUtc,
} from "../src/modules/billing/billing.service.js";
import { PLANS as ApiPlans, effectivePlan, planAllows } from "../src/modules/billing/plans.js";
import { PLANS as SharedPlans } from "@studyfy/shared-types";

const app = createApp();
const savedPlatformState = process.env.PLATFORM_STATE;

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; adminToken: string; adminId: string }> {
  const adminEmail = `billing-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Billing Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: adminEmail } } });
  return { schoolId, adminToken: res.body.data.accessToken as string, adminId: admin.id };
}

describe("billing math (§16.1, pure)", () => {
  it("uses ONE shared plan config (API re-export === shared-types object)", () => {
    // §16.1 single source of truth: the landing cards, the API gates and the
    // invoices all read the same object — a copy would let them drift apart.
    expect(ApiPlans).toBe(SharedPlans);
    expect(Object.keys(ApiPlans).sort()).toEqual(["BASIC", "PREMIUM", "STANDARD"]);
  });

  it("resolves financial years April–March", () => {
    expect(financialYear(new Date("2026-01-15T00:00:00Z"))).toBe("2025-26");
    expect(financialYear(new Date("2026-03-31T00:00:00Z"))).toBe("2025-26");
    expect(financialYear(new Date("2026-04-01T00:00:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2026-12-31T00:00:00Z"))).toBe("2026-27");
  });

  it("numbers invoices short with zero-padded counters", () => {
    expect(invoiceNumberFor("2026-27", 1)).toBe("STY/26-27/0001");
    expect(invoiceNumberFor("2026-27", 42)).toBe("STY/26-27/0042");
  });

  it("computes 18% GST rounded once, exact split for all three plan prices", () => {
    // BASIC ₹2,999: 53982 paise GST, halved exactly.
    expect(computeGst(299900, true)).toEqual({ cgst: 26991, sgst: 26991, igst: 0 });
    expect(computeGst(299900, false)).toEqual({ cgst: 0, sgst: 0, igst: 53982 });
    // STANDARD ₹5,999: 107982 paise GST, halved exactly.
    expect(computeGst(599900, true)).toEqual({ cgst: 53991, sgst: 53991, igst: 0 });
    expect(computeGst(599900, false)).toEqual({ cgst: 0, sgst: 0, igst: 107982 });
    // PREMIUM ₹9,999: 179982 paise GST, halved exactly.
    expect(computeGst(999900, true)).toEqual({ cgst: 89991, sgst: 89991, igst: 0 });
    expect(computeGst(999900, false)).toEqual({ cgst: 0, sgst: 0, igst: 179982 });
    // Every split sums to the once-rounded total, always.
    for (const price of [299900, 599900, 999900]) {
      const total = Math.round((price * 18) / 100);
      for (const sameState of [true, false]) {
        const split = computeGst(price, sameState);
        expect(split.cgst + split.sgst + split.igst).toBe(total);
      }
    }
  });

  it("resolves effective tiers: trial rides Standard, unknown fails closed to Basic", () => {
    expect(effectivePlan("TRIAL", null)).toBe("STANDARD");
    expect(effectivePlan("TRIAL", "BASIC")).toBe("STANDARD");
    expect(effectivePlan("ACTIVE", null)).toBe("BASIC");
    expect(effectivePlan("ACTIVE", "PREMIUM")).toBe("PREMIUM");
    expect(planAllows("TRIAL", null, "phase2")).toBe(true);
    expect(planAllows("TRIAL", null, "phase3")).toBe(false);
    expect(planAllows("ACTIVE", "BASIC", "phase1")).toBe(true);
    expect(planAllows("ACTIVE", "BASIC", "phase2")).toBe(false);
    expect(planAllows("ACTIVE", "PREMIUM", "phase3")).toBe(true);
  });

  it("gates access by dates, never by stored status alone", () => {
    const now = new Date("2026-10-11T00:00:00Z");
    const future = new Date("2026-12-31T00:00:00Z");
    const past = new Date("2026-09-01T00:00:00Z");
    expect(schoolAccess({ isDemo: true, subscriptionStatus: "SUSPENDED", trialEndsAt: past }, null, now)).toEqual({ allowed: true });
    expect(schoolAccess({ isDemo: false, subscriptionStatus: "SUSPENDED", trialEndsAt: future }, null, now)).toEqual({ allowed: false, code: "SCHOOL_SUSPENDED" });
    expect(schoolAccess({ isDemo: false, subscriptionStatus: "TRIAL", trialEndsAt: future }, null, now)).toEqual({ allowed: true });
    expect(schoolAccess({ isDemo: false, subscriptionStatus: "TRIAL", trialEndsAt: past }, null, now)).toEqual({ allowed: false, code: "TRIAL_EXPIRED" });
    expect(schoolAccess({ isDemo: false, subscriptionStatus: "ACTIVE", trialEndsAt: past }, null, now)).toEqual({ allowed: true });
    expect(
      schoolAccess({ isDemo: false, subscriptionStatus: "ACTIVE", trialEndsAt: past }, { status: "ACTIVE", currentPeriodEnd: addDays(now, -8) }, now),
    ).toEqual({ allowed: false, code: "SUBSCRIPTION_EXPIRED" });
    expect(
      schoolAccess({ isDemo: false, subscriptionStatus: "ACTIVE", trialEndsAt: past }, { status: "ACTIVE", currentPeriodEnd: addDays(now, -3) }, now),
    ).toEqual({ allowed: true });
    expect(
      schoolAccess({ isDemo: false, subscriptionStatus: "PAST_DUE", trialEndsAt: past }, { status: "PAST_DUE", currentPeriodEnd: addDays(now, -3) }, now),
    ).toEqual({ allowed: true });
  });
});

describe("invoices (§16.1, integration)", () => {
  it(
    "issues once per period, splits GST by state match, and survives a 5-way issuance race with one row",
    { timeout: 60000 },
    async () => {
      const school = await registerSchool(`Billing Issue School ${uid()}`);
      await prisma.school.update({ where: { id: school.schoolId }, data: { state: "Gujarat" } });
      process.env.PLATFORM_STATE = "Gujarat";
      try {
        const periodStart = startOfDayUtc(new Date("2026-11-01T00:00:00Z"));
        const periodEnd = startOfDayUtc(new Date("2026-11-30T00:00:00Z"));
        const input = { plan: "STANDARD" as const, periodStart, periodEnd, schoolState: "Gujarat", platformState: "Gujarat" };
        const first = await issueInvoice(prisma, school.schoolId, input, school.adminId);
        expect(first.invoiceNumber).toMatch(/^STY\/26-27\/\d{4}$/);
        const second = await issueInvoice(prisma, school.schoolId, input, school.adminId);
        expect(second.id).toBe(first.id);

        const raced = await Promise.allSettled(
          [1, 2, 3, 4, 5].map(() => issueInvoice(prisma, school.schoolId, input, school.adminId)),
        );
        expect(raced.every((r) => r.status === "fulfilled")).toBe(true);
        const rows = await prisma.subscriptionInvoice.findMany({ where: { schoolId: school.schoolId } });
        expect(rows).toHaveLength(1);

        const row = rows[0];
        expect(row).toBeDefined();
        expect(row?.amountPaise).toBe(599900);
        expect(row?.igstPaise).toBe(0);
        expect((row?.cgstPaise ?? 0) + (row?.sgstPaise ?? 0)).toBe(Math.round((599900 * 18) / 100));
        expect(row?.cgstPaise).toBe(row?.sgstPaise);

        // Mismatched states → IGST instead.
        const inter = await issueInvoice(
          prisma,
          school.schoolId,
          { plan: "BASIC" as const, periodStart: startOfDayUtc(new Date("2026-12-01T00:00:00Z")), periodEnd: startOfDayUtc(new Date("2026-12-31T00:00:00Z")), schoolState: "Gujarat", platformState: "Maharashtra" },
          school.adminId,
        );
        const interRow = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: inter.id } });
        expect(interRow.cgstPaise).toBe(0);
        expect(interRow.sgstPaise).toBe(0);
        expect(interRow.igstPaise).toBe(Math.round((299900 * 18) / 100));
      } finally {
        if (savedPlatformState === undefined) {
          delete process.env.PLATFORM_STATE;
        } else {
          process.env.PLATFORM_STATE = savedPlatformState;
        }
      }
    },
  );

  it(
    "issues 20 invoices in parallel with unique, gap-free numbers",
    { timeout: 180000 },
    async () => {
      // One financial year no other file touches (every other test lives in
      // FY 2026-27): the counter row below is OURS, so contiguity is
      // deterministic even with the whole suite running alongside.
      const tag = uid();
      const periodStart = startOfDayUtc(new Date("2030-11-01T00:00:00Z"));
      const periodEnd = startOfDayUtc(new Date("2030-11-30T00:00:00Z"));
      const fy = financialYear(periodStart);
      // Pre-create the counter row: the race must serialize on UPDATE row
      // locks (gap-free increments), never on INSERT races.
      await prisma.billingCounter.upsert({
        where: { financialYear: fy },
        update: {},
        create: { financialYear: fy, lastNumber: 0 },
      });
      // Twenty schools, direct creates (no bcrypt — passwords prove nothing
      // about numbering). Same period for all: only the counter separates
      // the twenty transactions.
      const schools = [];
      for (let i = 0; i < 20; i += 1) {
        schools.push(
          await prisma.school.create({
            data: {
              name: `Number Race School ${tag}-${i}`,
              slug: `number-race-${tag}-${i}`,
              trialEndsAt: new Date("2031-01-01T00:00:00Z"),
            },
          }),
        );
      }
      const input = {
        plan: "STANDARD" as const,
        periodStart,
        periodEnd,
        schoolState: "Gujarat",
        platformState: "Gujarat",
      };
      const raced = await Promise.allSettled(schools.map((s) => issueInvoice(prisma, s.id, input, null)));
      expect(raced.every((r) => r.status === "fulfilled")).toBe(true);
      const numbers = raced.map((r) => (r.status === "fulfilled" ? r.value.invoiceNumber : ""));
      // Unique ...
      expect(new Set(numbers).size).toBe(20);
      // ... and gap-free: the trailing counters form one contiguous range.
      const counters = numbers.map((n) => Number(n.slice(-4))).sort((a, b) => a - b);
      const min = Math.min(...counters);
      expect(counters).toEqual(Array.from({ length: 20 }, (_, i) => min + i));
      expect(numbers.every((n) => /^STY\/30-31\/\d{4}$/.test(n))).toBe(true);
    },
  );

  it(
    "mark-paid flips invoice + subscription + mirror in one audited transaction",
    { timeout: 60000 },
    async () => {
      const school = await registerSchool(`Billing Pay School ${uid()}`);
      await setSubscription(prisma, school.schoolId, { plan: "BASIC", status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: null }, school.adminId, "SUBSCRIPTION_CREATED");
      const periodStart = startOfDayUtc(new Date("2026-11-01T00:00:00Z"));
      const issued = await issueInvoice(
        prisma,
        school.schoolId,
        { plan: "BASIC" as const, periodStart, periodEnd: startOfDayUtc(new Date("2026-11-30T00:00:00Z")), schoolState: null, platformState: null },
        school.adminId,
      );
      const paid = await markInvoicePaid(prisma, issued.id, school.adminId);
      expect(paid.status).toBe("PAID");

      const invoice = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: issued.id } });
      expect(invoice.status).toBe("PAID");
      expect(invoice.paidMethod).toBe("MANUAL");
      expect(invoice.paidAt).not.toBeNull();
      const sub = await prisma.subscription.findUniqueOrThrow({ where: { schoolId: school.schoolId } });
      expect(sub.status).toBe("ACTIVE");
      expect(sub.currentPeriodStart).toEqual(periodStart);
      const mirror = await prisma.school.findUniqueOrThrow({ where: { id: school.schoolId } });
      expect(mirror.subscriptionStatus).toBe("ACTIVE");
      expect(mirror.plan).toBe("BASIC");

      const payRows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "SUBSCRIPTION_INVOICE_PAID" } });
      expect(payRows).toHaveLength(1);
      expect(payRows[0]?.actorId).toBe(school.adminId);
      expect(payRows[0]?.after).toMatchObject({ status: "PAID", paidMethod: "MANUAL" });
      const statusRows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "SUBSCRIPTION_STATUS_CHANGE" } });
      expect(statusRows.length).toBeGreaterThanOrEqual(1);

      // Idempotent re-pay: same answer, no second invoice row.
      const again = await markInvoicePaid(prisma, issued.id, school.adminId);
      expect(again.status).toBe("PAID");
      expect(await prisma.auditLog.count({ where: { schoolId: school.schoolId, action: "SUBSCRIPTION_INVOICE_PAID" } })).toBe(1);
    },
  );

  it(
    "online capture mirrors the invoiced plan onto the subscription and school",
    { timeout: 60000 },
    async () => {
      const school = await registerSchool(`Billing Plan School ${uid()}`);
      await prisma.school.update({ where: { id: school.schoolId }, data: { plan: "STANDARD" } });
      const periodStart = startOfDayUtc(new Date("2026-12-01T00:00:00Z"));
      const periodEnd = startOfDayUtc(new Date("2026-12-31T00:00:00Z"));
      const issued = await issueInvoice(
        prisma,
        school.schoolId,
        { plan: "STANDARD" as const, periodStart, periodEnd, schoolState: null, platformState: null },
        school.adminId,
      );
      const invoice = await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: issued.id } });
      const total = invoice.amountPaise + invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise;
      const orderId = `order_PLAN_${uid()}`;
      const paymentId = `pay_PLAN_${uid()}`;
      await prisma.subscriptionInvoice.update({ where: { id: issued.id }, data: { razorpayOrderId: orderId } });
      const captured = await recordSubscriptionCapture(prisma, { razorpayOrderId: orderId, razorpayPaymentId: paymentId, amountPaise: total }, null);
      expect(captured.status).toBe("PAID");
      expect((await prisma.subscription.findUniqueOrThrow({ where: { schoolId: school.schoolId } })).plan).toBe("STANDARD");
      expect((await prisma.school.findUniqueOrThrow({ where: { id: school.schoolId } })).plan).toBe("STANDARD");
    },
  );

  it(
    "manual collection mirrors the invoiced plan onto the subscription and school",
    { timeout: 60000 },
    async () => {
      const school = await registerSchool(`Billing Manual Plan School ${uid()}`);
      const periodStart = startOfDayUtc(new Date("2026-11-01T00:00:00Z"));
      const periodEnd = startOfDayUtc(new Date("2026-11-30T00:00:00Z"));
      const issued = await issueInvoice(
        prisma,
        school.schoolId,
        { plan: "PREMIUM" as const, periodStart, periodEnd, schoolState: null, platformState: null },
        school.adminId,
      );
      await markInvoicePaid(prisma, issued.id, school.adminId);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { schoolId: school.schoolId } })).plan).toBe("PREMIUM");
      const mirror = await prisma.school.findUniqueOrThrow({ where: { id: school.schoolId } });
      expect(mirror.plan).toBe("PREMIUM");
      expect(mirror.subscriptionStatus).toBe("ACTIVE");
    },
  );

  it(
    "paid invoices flow into owner revenue and the plan mix (invalidation proven)",
    { timeout: 60000 },
    async () => {
      const { getOwnerDashboard } = await import("../src/modules/metrics/metrics.service.js");
      const school = await registerSchool(`Billing Revenue School ${uid()}`);
      // BASIC 299900 + 18% (53982, same-state Gujarat) = 353882 paise.
      await prisma.school.update({ where: { id: school.schoolId }, data: { state: "Gujarat" } });
      process.env.PLATFORM_STATE = "Gujarat";
      try {
        await setSubscription(prisma, school.schoolId, { plan: "BASIC", status: "ACTIVE", currentPeriodStart: null, currentPeriodEnd: null }, school.adminId, "SUBSCRIPTION_CREATED");
        const issued = await issueInvoice(
          prisma,
          school.schoolId,
          { plan: "BASIC" as const, periodStart: startOfDayUtc(new Date("2026-11-01T00:00:00Z")), periodEnd: startOfDayUtc(new Date("2026-11-30T00:00:00Z")), schoolState: "Gujarat", platformState: "Gujarat" },
          school.adminId,
        );
        await markInvoicePaid(prisma, issued.id, school.adminId);
        // Parallel files also write invoices — floor assert on OUR total,
        // exact-total would be order-dependent.
        const board = await getOwnerDashboard(prisma);
        expect(Number(board.totalRevenue)).toBeGreaterThanOrEqual(3538.82);
        const basic = board.plans.find((p) => p.plan === "BASIC");
        expect(basic?.schools).toBeGreaterThanOrEqual(1);
      } finally {
        if (savedPlatformState === undefined) {
          delete process.env.PLATFORM_STATE;
        } else {
          process.env.PLATFORM_STATE = savedPlatformState;
        }
      }
    },
  );
});

describe("billing cycle (§12.4 + §16.1)", () => {
  it(
    "lapses trials to PAST_DUE with an invoice, suspends past grace, skips demos, and repeats change nothing",
    { timeout: 60000 },
    async () => {
      const lapsed = await registerSchool(`Billing Lapsed School ${uid()}`);
      await prisma.school.update({ where: { id: lapsed.schoolId }, data: { trialEndsAt: new Date("2026-09-01T00:00:00Z") } });
      const demo = await registerSchool(`Billing Demo School ${uid()}`);
      await prisma.school.update({ where: { id: demo.schoolId }, data: { isDemo: true, trialEndsAt: new Date("2026-09-01T00:00:00Z") } });

      const t1 = new Date("2026-10-11T00:00:00Z");
      const scope = { schoolIds: [lapsed.schoolId, demo.schoolId] };
      const first = await runBillingCycle(prisma, t1, scope);
      expect(first.transitioned.some((t) => t.schoolId === lapsed.schoolId && t.from === "TRIAL" && t.to === "PAST_DUE")).toBe(true);
      expect(first.invoicesIssued).toBeGreaterThanOrEqual(1);
      expect(first.transitioned.some((t) => t.schoolId === demo.schoolId)).toBe(false);
      expect(await prisma.subscriptionInvoice.count({ where: { schoolId: demo.schoolId } })).toBe(0);
      const lapsedSub = await prisma.subscription.findUniqueOrThrow({ where: { schoolId: lapsed.schoolId } });
      expect(lapsedSub.status).toBe("PAST_DUE");

      // Re-run at the same instant: nothing new (idempotent).
      const second = await runBillingCycle(prisma, t1, scope);
      expect(second.transitioned.filter((t) => t.schoolId === lapsed.schoolId)).toHaveLength(0);
      expect(await prisma.subscriptionInvoice.count({ where: { schoolId: lapsed.schoolId } })).toBe(1);

      // 8 days later (past the 7-day grace): suspended, data retained.
      const third = await runBillingCycle(prisma, new Date("2026-10-19T00:00:00Z"), scope);
      expect(third.transitioned.some((t) => t.schoolId === lapsed.schoolId && t.from === "PAST_DUE" && t.to === "SUSPENDED")).toBe(true);
      const mirror = await prisma.school.findUniqueOrThrow({ where: { id: lapsed.schoolId } });
      expect(mirror.subscriptionStatus).toBe("SUSPENDED");
      expect(await prisma.user.count({ where: { schoolId: lapsed.schoolId } })).toBeGreaterThan(0);
    },
  );
});
