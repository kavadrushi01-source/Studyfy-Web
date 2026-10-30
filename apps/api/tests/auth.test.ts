import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { REFRESH_COOKIE } from "../src/modules/auth/auth.router.js";

const app = createApp();

function accessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET must be set to run API tests.");
  }
  return secret;
}

function uid(): string {
  return randomUUID().slice(0, 8);
}

function refreshPair(res: request.Response): string | undefined {
  const cookies = res.headers["set-cookie"] as unknown as string[] | undefined;
  return cookies?.find((c) => c.startsWith(`${REFRESH_COOKIE}=`))?.split(";")[0];
}

interface RegisterResponse {
  school: { id: string; name: string; slug: string };
  user: { id: string; email: string; role: string; schoolId: string | null };
  accessToken: string;
}

async function registerSchool(schoolName: string): Promise<{ body: RegisterResponse; cookie: string }> {
  const adminEmail = `admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName,
      city: "Pune",
      state: "Maharashtra",
      adminName: "Test Admin",
      adminEmail,
      adminPassword: "password-123",
    })
    .expect(201);
  const cookie = refreshPair(res);
  expect(cookie, "register must set the refresh cookie").toBeDefined();
  return { body: res.body.data as RegisterResponse, cookie: cookie ?? "" };
}

async function createOwner(email: string, password: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { name: "PLATFORM_OWNER" } });
  expect(role, "PLATFORM_OWNER role must be seeded").not.toBeNull();
  await prisma.user.create({
    data: {
      schoolId: null,
      roleId: role?.id ?? "",
      email,
      passwordHash: await bcrypt.hash(password, 4),
      name: "Platform Owner",
    },
  });
}

describe("POST /api/v1/auth/register", () => {
  it("creates a TRIAL school (14-day trial) + admin and logs in", async () => {
    const name = `Test School ${uid()}`;
    const { body } = await registerSchool(name);

    expect(body.school.name).toBe(name);
    expect(body.school.slug).toMatch(/^[a-z0-9-]+$/);
    expect(body.user.role).toBe("SCHOOL_ADMIN");
    expect(body.user.schoolId).toBe(body.school.id);

    const decoded = jwt.verify(body.accessToken, accessSecret()) as Record<string, unknown>;
    expect(decoded["sub"]).toBe(body.user.id);
    expect(decoded["schoolId"]).toBe(body.school.id);
    expect(decoded["role"]).toBe("SCHOOL_ADMIN");

    const school = await prisma.school.findUnique({ where: { id: body.school.id } });
    expect(school?.subscriptionStatus).toBe("TRIAL");
    const trialMs = (school?.trialEndsAt.getTime() ?? 0) - Date.now();
    expect(trialMs).toBeGreaterThan(14 * 24 * 60 * 60 * 1000 - 5 * 60 * 1000);
    expect(trialMs).toBeLessThanOrEqual(14 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000);
  });

  it("suffixes the slug on collision instead of failing", async () => {
    const name = `Same Name School ${uid()}`;
    const first = await registerSchool(name);
    const second = await registerSchool(name);
    expect(second.body.school.slug).not.toBe(first.body.school.slug);
    expect(second.body.school.slug.startsWith(first.body.school.slug)).toBe(true);
  });

  it("rejects a short password with VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({
        schoolName: `Weak Pass School ${uid()}`,
        adminName: "Test Admin",
        adminEmail: `admin-${uid()}@example.com`,
        adminPassword: "short",
      })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/auth/login", () => {
  it("logs in with school slug + sets cookie + access token", async () => {
    const { body } = await registerSchool(`Login School ${uid()}`);
    const adminEmail = body.user.email;

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: adminEmail, password: "password-123", schoolSlug: body.school.slug })
      .expect(200);

    expect(res.body.data.user.email).toBe(adminEmail);
    expect(refreshPair(res)).toBeDefined();
    const decoded = jwt.verify(res.body.data.accessToken as string, accessSecret()) as Record<string, unknown>;
    expect(decoded["sub"]).toBe(body.user.id);
  });

  it("makes production demo logins read-only and omits the refresh cookie", async () => {
    const { body } = await registerSchool(`Read Only Demo ${uid()}`);
    const schoolId = body.user.schoolId;
    if (!schoolId) {
      throw new Error("Registered demo fixture has no school id.");
    }
    await prisma.school.update({ where: { id: schoolId }, data: { isDemo: true } });
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: body.user.email, password: "password-123", schoolSlug: body.school.slug })
        .expect(200);
      expect(login.body.data.readOnlyDemo).toBe(true);
      expect(refreshPair(login)).toBeUndefined();
      const decoded = jwt.verify(login.body.data.accessToken as string, accessSecret()) as Record<string, unknown>;
      expect(decoded.readOnly).toBe(true);

      const write = await request(app)
        .post(`/api/v1/schools/${schoolId}/students`)
        .set("Authorization", `Bearer ${login.body.data.accessToken as string}`)
        .send({});
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe("READ_ONLY_SESSION");
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  it("returns the SAME 401 for wrong password, unknown email, and unknown slug", async () => {
    const { body } = await registerSchool(`Enum School ${uid()}`);

    const wrongPass = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: body.user.email, password: "wrong-password", schoolSlug: body.school.slug })
      .expect(401);
    const unknownEmail = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: `nobody-${uid()}@example.com`, password: "password-123", schoolSlug: body.school.slug })
      .expect(401);
    const unknownSlug = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: body.user.email, password: "password-123", schoolSlug: `no-such-${uid()}` })
      .expect(401);

    for (const res of [wrongPass, unknownEmail, unknownSlug]) {
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
      expect(res.body.error.message).toBe("Invalid email or password.");
    }
  });

  it("rejects a school admin logging in without a slug (owner path only)", async () => {
    const { body } = await registerSchool(`Owner Path School ${uid()}`);
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: body.user.email, password: "password-123" })
      .expect(401);
  });

  it("logs the Platform Owner in with NO slug, and rejects them WITH a slug", async () => {
    const email = `owner-${uid()}@example.com`;
    await createOwner(email, "owner-pass-123");

    const ok = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
    expect(ok.body.data.user.role).toBe("PLATFORM_OWNER");
    expect(ok.body.data.user.schoolId).toBeNull();

    const { body } = await registerSchool(`Owner Slug School ${uid()}`);
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "owner-pass-123", schoolSlug: body.school.slug })
      .expect(401);
  });

  it("blocks suspended schools, expired trials, and disabled accounts", async () => {
    const { body } = await registerSchool(`Gate School ${uid()}`);

    await prisma.school.update({
      where: { id: body.school.id },
      data: { subscriptionStatus: "SUSPENDED" },
    });
    // Suspended admin CAN log in (§13.4 exception — billing is reachable);
    // everyone else on the suspended school still gets 403 (proven in
    // billing-owner.test.ts, both directions).
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: body.user.email, password: "password-123", schoolSlug: body.school.slug })
      .expect(200);

    await prisma.school.update({
      where: { id: body.school.id },
      data: { subscriptionStatus: "TRIAL", trialEndsAt: new Date(Date.now() - 1000) },
    });
    const expired = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: body.user.email, password: "password-123", schoolSlug: body.school.slug })
      .expect(403);
    expect(expired.body.error.code).toBe("TRIAL_EXPIRED");

    await prisma.school.update({
      where: { id: body.school.id },
      data: { trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
    });
    await prisma.user.update({ where: { id: body.user.id }, data: { isActive: false } });
    const disabled = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: body.user.email, password: "password-123", schoolSlug: body.school.slug })
      .expect(403);
    expect(disabled.body.error.code).toBe("ACCOUNT_DISABLED");
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("rotates the refresh token and rejects replay of the old one", async () => {
    const { body, cookie: firstCookie } = await registerSchool(`Refresh School ${uid()}`);

    const rotated = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", firstCookie)
      .expect(200);
    const secondCookie = refreshPair(rotated);
    expect(secondCookie).toBeDefined();
    expect(secondCookie).not.toBe(firstCookie);
    const decoded = jwt.verify(rotated.body.data.accessToken as string, accessSecret()) as Record<string, unknown>;
    expect(decoded["sub"]).toBe(body.user.id);

    // Replay the consumed token: theft detected, chain killed.
    const replay = await request(app).post("/api/v1/auth/refresh").set("Cookie", firstCookie).expect(403);
    expect(replay.body.error.code).toBe("REFRESH_TOKEN_REUSED");

    // The rotated token died with the chain.
    await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", secondCookie ?? "")
      .expect(403);
  });

  it("rejects a missing cookie with 401", async () => {
    const res = await request(app).post("/api/v1/auth/refresh").expect(401);
    expect(res.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });
});
