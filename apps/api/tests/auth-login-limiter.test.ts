import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";

// Account-keyed login limiter tests (§11). This file exercises REAL
// limiter behavior, so it opts out of the NODE_ENV=test bypass BEFORE
// createApp() wires middleware (maybeLimit reads env once, at route
// setup - flipping it per-test would do nothing). The IP limiter is
// quieted to 1000 so only the account limiter under test can trip; the
// account knob stays at its default 5. Everything is restored after.
const SAVED_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
const SAVED_IP_LIMIT = process.env.LOGIN_RATE_LIMIT_MAX;
process.env.LOGIN_RATE_LIMIT_MAX = "1000";
const SAVED_ACCOUNT_LIMIT = process.env.LOGIN_ACCOUNT_LIMIT_MAX;
delete process.env.LOGIN_ACCOUNT_LIMIT_MAX;
afterAll(() => {
  if (SAVED_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = SAVED_NODE_ENV;
  }
  if (SAVED_IP_LIMIT === undefined) {
    delete process.env.LOGIN_RATE_LIMIT_MAX;
  } else {
    process.env.LOGIN_RATE_LIMIT_MAX = SAVED_IP_LIMIT;
  }
  if (SAVED_ACCOUNT_LIMIT === undefined) {
    delete process.env.LOGIN_ACCOUNT_LIMIT_MAX;
  } else {
    process.env.LOGIN_ACCOUNT_LIMIT_MAX = SAVED_ACCOUNT_LIMIT;
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

// File-wide production env (above) already activates the limiters, so
// this is a pass-through kept so each test reads as its own scenario.
async function withProdEnv<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

// §11 account guard: 5 failures for one account -> the 6th is refused,
// deterministically, no matter which IPs the attempts arrive from
// (per-IP buckets are unreliable behind Render's proxy chain - the
// account key is what makes brute force fail closed).
describe("POST /api/v1/auth/login account limiter (§11)", () => {
  it("locks one account after 5 failures; other accounts unaffected", async () => {
    const email = `lock-${uid()}@example.com`;
    const other = `other-${uid()}@example.com`;
    await withProdEnv(async () => {
      for (let i = 0; i < 5; i += 1) {
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email, password: "wrong" })
          .expect(401);
      }
      const locked = await request(app).post("/api/v1/auth/login").send({ email, password: "wrong" }).expect(429);
      expect(locked.body.error.code).toBe("RATE_LIMITED");
      expect(locked.body.error.message).toContain("this account");

      const stranger = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: other, password: "wrong" })
        .expect(401);
      expect(stranger.body.error.code).not.toBe("RATE_LIMITED");
    });
  });

  it("successful logins do not consume the failure budget, and lock applies even with the right password", async () => {
    const adminName = `Budget Admin ${uid()}`;
    const adminEmail = `budget-admin-${uid()}@example.com`;
    const adminPassword = "password-123";
    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        schoolName: `Budget School ${uid()}`,
        adminName,
        adminEmail,
        adminPassword,
      })
      .expect(201);
    const slug = reg.body.data.school.slug as string;
    await withProdEnv(async () => {
      // A success consumes no budget...
      await request(app)
        .post("/api/v1/auth/login")
        .send({ email: adminEmail, password: adminPassword, schoolSlug: slug })
        .expect(200);
      // ...so all 5 failures still fit, and the 6th locks the account.
      for (let i = 0; i < 5; i += 1) {
        await request(app).post("/api/v1/auth/login").send({ email: adminEmail, password: "wrong" }).expect(401);
      }
      // Locked means locked: even the right password is refused now.
      const locked = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: adminEmail, password: adminPassword, schoolSlug: slug })
        .expect(429);
      expect(locked.body.error.code).toBe("RATE_LIMITED");
    });
  });

  it("keys on normalized email (case + padding do not open new buckets)", async () => {
    const base = `Case-${uid()}@example.com`;
    await withProdEnv(async () => {
      for (let i = 0; i < 3; i += 1) {
        await request(app).post("/api/v1/auth/login").send({ email: base, password: "wrong" }).expect(401);
      }
      for (let i = 0; i < 2; i += 1) {
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: `  ${base.toUpperCase()}  `, password: "wrong" })
          .expect(401);
      }
      const locked = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: base.toLowerCase(), password: "wrong" })
        .expect(429);
      expect(locked.body.error.code).toBe("RATE_LIMITED");
    });
  });
});
