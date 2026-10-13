import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { issueInvoice, markInvoicePaid, recordSubscriptionCapture, startOfDayUtc } from "../src/modules/billing/billing.service.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Owner Board School ${uid()}`,
      adminName: "Owner Board Admin",
      adminEmail: `owner-board-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function ownerToken(): Promise<string> {
  const email = `board-owner-${uid()}@example.com`;
  const password = "owner-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
  await prisma.user.create({
    data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Board Owner" },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password }).expect(200);
  return login.body.data.accessToken as string;
}

interface OwnerBundle {
  totalSchools: number;
  activeSchools: number;
  trialPending: number;
  totalRevenue: string;
  revenueByMethod: { method: string; total: string }[];
  suspendedSchools: number;
  revenueTrend: { month: string; total: string }[];
  schools: { id: string; name: string; slug: string; subscriptionStatus: string; users: number; students: number }[];
  analytics: { month: string; schools: number }[];
  plans: { plan: string; schools: number }[];
  asOf: { month: string };
}

describe("GET /api/v1/platform/dashboard (§8.3 + sequencing note)", () => {
  it(
    "returns live school counts, the schools table, and honest Phase-4 zeros",
    async () => {
      const token = await ownerToken();
      const schoolA = await registerSchool();
      const schoolB = await registerSchool();
      await prisma.school.update({ where: { id: schoolA.schoolId }, data: { subscriptionStatus: "ACTIVE" } });

      const res = await request(app)
        .get("/api/v1/platform/dashboard")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const board = res.body.data.dashboard as OwnerBundle;
      // Global counts: other parallel files register schools too, so floor
      // assertions + internal consistency, never exact totals.
      expect(board.totalSchools).toBeGreaterThanOrEqual(2);
      expect(board.activeSchools).toBeGreaterThanOrEqual(1);
      expect(board.trialPending).toBeGreaterThanOrEqual(1);
      const slugs = board.schools.map((s) => s.slug);
      expect(slugs).toContain(schoolA.slug);
      expect(slugs).toContain(schoolB.slug);
      const rowA = board.schools.find((s) => s.slug === schoolA.slug)!;
      expect(rowA.subscriptionStatus).toBe("ACTIVE");
      // Billing figures are COMPUTED now (Chunk 2), never projected: revenue
      // is the formatted SUM of paid invoices (zero only when none are
      // paid), plans the live non-null mix. Exact values are
      // order-dependent in the shared DB — shape + formatting here, exact
      // proofs in billing.test.ts.
      expect(board.totalRevenue).toMatch(/^\d+\.\d{2}$/);
      for (const entry of board.plans) {
        expect(typeof entry.plan).toBe("string");
        expect(entry.schools).toBeGreaterThanOrEqual(1);
      }
      expect(board.analytics).toHaveLength(6);
      const current = board.analytics[board.analytics.length - 1]!;
      expect(current.month).toBe(board.asOf.month);
      expect(current.schools).toBeGreaterThanOrEqual(2);
    },
    30000,
  );

  it(
    "splits revenue into MANUAL and TEST legs that sum to the total",
    async () => {
      const token = await ownerToken();
      const school = await registerSchool();
      const admin = await prisma.user.findFirstOrThrow({ where: { schoolId: school.schoolId } });
      // BASIC ₹2,999 + 18% = 353882 paise → "3538.82", each leg.
      const manual = await issueInvoice(
        prisma,
        school.schoolId,
        { plan: "BASIC", periodStart: startOfDayUtc(new Date("2026-11-01T00:00:00Z")), periodEnd: startOfDayUtc(new Date("2026-11-30T00:00:00Z")), schoolState: null, platformState: null },
        admin.id,
      );
      await markInvoicePaid(prisma, manual.id, admin.id);
      const online = await issueInvoice(
        prisma,
        school.schoolId,
        { plan: "BASIC", periodStart: startOfDayUtc(new Date("2026-12-01T00:00:00Z")), periodEnd: startOfDayUtc(new Date("2026-12-31T00:00:00Z")), schoolState: null, platformState: null },
        admin.id,
      );
      const orderId = `order_SPLIT_${uid()}`;
      await prisma.subscriptionInvoice.update({ where: { id: online.id }, data: { razorpayOrderId: orderId } });
      await recordSubscriptionCapture(
        prisma,
        { razorpayOrderId: orderId, razorpayPaymentId: `pay_SPLIT_${uid()}`, amountPaise: 353882 },
        null,
      );

      const res = await request(app)
        .get("/api/v1/platform/dashboard")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const board = res.body.data.dashboard as OwnerBundle;
      // Parallel files record their own paid invoices — floors, never exact.
      const leg = (method: string): number => Number(board.revenueByMethod.find((l) => l.method === method)?.total ?? "0");
      expect(leg("MANUAL")).toBeGreaterThanOrEqual(3538.82);
      expect(leg("RAZORPAY")).toBeGreaterThanOrEqual(3538.82);
      // Same paise math at both levels: legs sum to the total.
      const legsSum = board.revenueByMethod.reduce((sum, l) => sum + Number(l.total), 0);
      expect(Math.abs(legsSum - Number(board.totalRevenue))).toBeLessThan(0.02);
    },
    30000,
  );

  it(
    "reports suspended counts and a monthly revenue trend (explicit clock)",
    async () => {
      // Explicit May-2027 clock: the board caches per calendar month, so a
      // far-future instant gets a cold cache entry no other test can warm —
      // deterministic even with the whole suite running alongside.
      const now = new Date("2027-05-15T00:00:00Z");
      const token = await ownerToken();
      const school = await registerSchool();
      await prisma.school.update({ where: { id: school.schoolId }, data: { subscriptionStatus: "SUSPENDED" } });
      const admin = await prisma.user.findFirstOrThrow({ where: { schoolId: school.schoolId } });
      // BASIC ₹2,999 + 18% = 353882 paise ("3538.82") paid in March, twice
      // that stock in April — both land in their paidAt months.
      for (const [month, count] of [[3, 1], [4, 2]] as const) {
        for (let i = 0; i < count; i += 1) {
          const start = `2027-0${month}-0${1 + i}T00:00:00Z`;
          const end = `2027-0${month}-2${i}T00:00:00Z`;
          const issued = await issueInvoice(
            prisma,
            school.schoolId,
            { plan: "BASIC", periodStart: new Date(start), periodEnd: new Date(end), schoolState: null, platformState: null },
            admin.id,
          );
          await prisma.subscriptionInvoice.update({
            where: { id: issued.id },
            data: { status: "PAID", paidAt: new Date(`2027-0${month}-15T00:00:00Z`), paidMethod: "MANUAL" },
          });
        }
      }

      const { getOwnerDashboard } = await import("../src/modules/metrics/metrics.service.js");
      const board = await getOwnerDashboard(prisma, now);
      expect(board.suspendedSchools).toBeGreaterThanOrEqual(1);
      const bucket = (month: string): number =>
        Number(board.revenueTrend.find((p) => p.month === month)?.total ?? "0");
      expect(bucket("2027-03")).toBeGreaterThanOrEqual(3538.82);
      expect(bucket("2027-04")).toBeGreaterThanOrEqual(7077.64);
      expect(bucket("2027-05")).toBe(0);
      // Six-month window ending at the clock month, newest last.
      expect(board.revenueTrend).toHaveLength(6);
      expect(board.revenueTrend[5]?.month).toBe("2027-05");

      // Same shape over HTTP.
      const res = await request(app)
        .get("/api/v1/platform/dashboard")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const http = res.body.data.dashboard as OwnerBundle;
      expect(typeof http.suspendedSchools).toBe("number");
      expect(http.revenueTrend).toHaveLength(6);
    },
    30000,
  );

  it(
    "reflects new registrations through the route (write invalidates)",
    async () => {
      const token = await ownerToken();
      const before = await request(app)
        .get("/api/v1/platform/dashboard")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const totalBefore = (before.body.data.dashboard as OwnerBundle).totalSchools;

      const fresh = await registerSchool();

      const after = await request(app)
        .get("/api/v1/platform/dashboard")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const board = after.body.data.dashboard as OwnerBundle;
      // Other workers may register concurrently: floor, never exact.
      expect(board.totalSchools).toBeGreaterThanOrEqual(totalBefore + 1);
      expect(board.schools.map((s) => s.slug)).toContain(fresh.slug);
    },
    30000,
  );

  it(
    "is owner-only: school admins denied, strangers 401",
    async () => {
      const token = await ownerToken();
      void token;
      const school = await registerSchool();

      const denied = await request(app)
        .get("/api/v1/platform/dashboard")
        .set("Authorization", `Bearer ${school.adminToken}`)
        .expect(403);
      expect(denied.body.error.code).toBe("FORBIDDEN");

      await request(app).get("/api/v1/platform/dashboard").expect(401);
    },
    30000,
  );
});
