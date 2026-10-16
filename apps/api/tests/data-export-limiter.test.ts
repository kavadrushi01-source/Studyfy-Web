import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";

// Export limiter (§13.10): one per HOUR per SCHOOL by default. This file
// exercises REAL limiter behavior, so it opts out of the NODE_ENV=test
// bypass BEFORE createApp() wires middleware (maybeLimit reads env once,
// at route setup), and pins the knob to its default of 1. Same pattern as
// the ticket-creation limiter test. Everything is restored after.
const SAVED_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
const SAVED_EXPORT_LIMIT = process.env.EXPORT_RATE_LIMIT_MAX;
delete process.env.EXPORT_RATE_LIMIT_MAX;
const SAVED_REGISTER_LIMIT = process.env.REGISTER_RATE_LIMIT_MAX;
delete process.env.REGISTER_RATE_LIMIT_MAX;
afterAll(() => {
  if (SAVED_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = SAVED_NODE_ENV;
  }
  if (SAVED_EXPORT_LIMIT === undefined) {
    delete process.env.EXPORT_RATE_LIMIT_MAX;
  } else {
    process.env.EXPORT_RATE_LIMIT_MAX = SAVED_EXPORT_LIMIT;
  }
  if (SAVED_REGISTER_LIMIT === undefined) {
    delete process.env.REGISTER_RATE_LIMIT_MAX;
  } else {
    process.env.REGISTER_RATE_LIMIT_MAX = SAVED_REGISTER_LIMIT;
  }
});

// Dynamic import AFTER the env assignments above: Express routers wire
// middleware at module load, so a static import would bake in the
// NODE_ENV=test bypass before these lines ever run.
const { createApp } = await import("../src/app.js");
const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function newSchool(): Promise<{ schoolId: string; auth: { Authorization: string } }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Export Limiter ${uid()}`,
      adminName: "Limiter Admin",
      adminEmail: `export-limiter-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    auth: { Authorization: `Bearer ${res.body.data.accessToken as string}` },
  };
}

async function loginOwner(): Promise<{ Authorization: string }> {
  const email = `export-limiter-owner-${uid()}@example.com`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
  await prisma.user.create({
    data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Export Limiter Owner" },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
  return { Authorization: `Bearer ${res.body.data.accessToken as string}` };
}

describe("POST /api/v1/schools/:id/exports limiter (§13.10)", () => {
  it("allows one export per hour per school across tenant and owner routes, then 429s; other schools stay open", async () => {
    const school = await newSchool();
    const url = `/api/v1/schools/${school.schoolId}/exports`;

    await request(app).post(url).set(school.auth).expect(200);
    const blocked = await request(app).post(url).set(school.auth).expect(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");

    const ownerAuth = await loginOwner();
    const ownerBlocked = await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/exports`)
      .set(ownerAuth)
      .send({ reason: "Shared export budget verification for the same school." })
      .expect(429);
    expect(ownerBlocked.body.error.code).toBe("RATE_LIMITED");

    // Budget is per school: a different school exports freely.
    const other = await newSchool();
    await request(app).post(`/api/v1/schools/${other.schoolId}/exports`).set(other.auth).expect(200);
  });
});
