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

async function registerSchool(name: string): Promise<{ schoolId: string; token: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: name,
      adminName: "Platform Test Admin",
      adminEmail: `platform-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return { schoolId: res.body.data.school.id as string, token: res.body.data.accessToken as string };
}

async function loginOwner(): Promise<string> {
  const email = `owner-${uid()}@example.com`;
  const role = await prisma.role.findUnique({ where: { name: "PLATFORM_OWNER" } });
  expect(role, "PLATFORM_OWNER role must be seeded").not.toBeNull();
  await prisma.user.create({
    data: {
      schoolId: null,
      roleId: role?.id ?? "",
      email,
      passwordHash: await bcrypt.hash("owner-pass-123", 4),
      name: "Platform Owner",
    },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
  return res.body.data.accessToken as string;
}

describe("platform owner routes (SECURITY_PATTERNS.md §2)", () => {
  it("rejects a School Admin hitting /platform/schools with 403", async () => {
    const schoolA = await registerSchool(`Platform School A ${uid()}`);

    const res = await request(app)
      .get("/api/v1/platform/schools")
      .set("Authorization", `Bearer ${schoolA.token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("lets a Platform Owner see schools across tenants", async () => {
    const schoolA = await registerSchool(`Platform School B ${uid()}`);
    const schoolB = await registerSchool(`Platform School C ${uid()}`);
    const ownerToken = await loginOwner();

    const res = await request(app)
      .get("/api/v1/platform/schools")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    const ids = (res.body.data.schools as { id: string }[]).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([schoolA.schoolId, schoolB.schoolId]));
  });

  it("rejects unauthenticated access to /platform/schools with 401", async () => {
    const res = await request(app).get("/api/v1/platform/schools");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("serves read-only settings with booleans, never secrets", async () => {
    const ownerToken = await loginOwner();
    const res = await request(app)
      .get("/api/v1/platform/settings")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    const data = res.body.data;
    expect(typeof data.environment).toBe("string");
    expect(["TEST", "UNCONFIGURED", "NON_TEST"]).toContain(data.testMode);
    for (const flag of ["gstinConfigured", "platformStateConfigured", "demoPasswordConfigured"] as const) {
      expect(typeof data[flag]).toBe("boolean");
    }
    expect(typeof data.demoSchools).toBe("number");
    expect(data.plans.BASIC.pricePaise).toBe(299900);
    expect(data.plans.STANDARD.pricePaise).toBe(599900);
    expect(data.plans.PREMIUM.pricePaise).toBe(999900);
    // No secret ever leaves here: scan every string VALUE (key names like
    // demoPasswordConfigured legitimately contain the word) for key
    // material, hashes, tokens, or PEM blocks.
    const values: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") {
        values.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(collect);
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(collect);
      }
    };
    collect(res.body.data);
    for (const value of values) {
      expect(value).not.toMatch(/rzp_test_/);
      expect(value).not.toMatch(/^[0-9a-f]{32,}$/);
      expect(value).not.toMatch(/BEGIN /);
      expect(value).not.toMatch(/sk_live/);
    }
  });

  it("refuses tenant admins and strangers on /platform/settings", async () => {
    const schoolA = await registerSchool(`Platform Settings School ${uid()}`);
    expect((await request(app).get("/api/v1/platform/settings").set("Authorization", `Bearer ${schoolA.token}`)).status).toBe(403);
    expect((await request(app).get("/api/v1/platform/settings")).status).toBe(401);
  });

  it("rejects unauthenticated access to tenant routes with 401", async () => {
    const schoolA = await registerSchool(`Platform School D ${uid()}`);
    const res = await request(app).get(`/api/v1/schools/${schoolA.schoolId}/students`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});
