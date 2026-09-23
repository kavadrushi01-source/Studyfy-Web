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
      // Billing data doesn't exist until Phase 4: zeros, never projections.
      expect(board.totalRevenue).toBe("0.00");
      expect(board.plans).toEqual([]);
      expect(board.analytics).toHaveLength(6);
      const current = board.analytics[board.analytics.length - 1]!;
      expect(current.month).toBe(board.asOf.month);
      expect(current.schools).toBeGreaterThanOrEqual(2);
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
