import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";

// Register/forgot shared bucket (§13.5): register+forgot+reset share one
// 10/hour/IP bucket (proven by the wiring — auth.router lines 78/195/216
// all mount registerLimiter()). This file exercises REAL limiter behavior,
// so it opts out of the NODE_ENV=test bypass BEFORE createApp() wires
// middleware (maybeLimit reads env once, at route setup). Defaults apply
// (no knob overrides) — these are the exact production budgets.
// Everything restored after.
const SAVED_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
const SAVED_REGISTER_LIMIT = process.env.REGISTER_RATE_LIMIT_MAX;
delete process.env.REGISTER_RATE_LIMIT_MAX;
const SAVED_ACCOUNT_LIMIT = process.env.LOGIN_ACCOUNT_LIMIT_MAX;
delete process.env.LOGIN_ACCOUNT_LIMIT_MAX;
afterAll(() => {
  if (SAVED_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = SAVED_NODE_ENV;
  }
  if (SAVED_REGISTER_LIMIT === undefined) {
    delete process.env.REGISTER_RATE_LIMIT_MAX;
  } else {
    process.env.REGISTER_RATE_LIMIT_MAX = SAVED_REGISTER_LIMIT;
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

describe("register/forgot shared bucket (§13.5)", () => {
  it("fills the 10/hour register budget, then refuses register AND forgot-password", async () => {
    for (let i = 0; i < 10; i += 1) {
      await request(app)
        .post("/api/v1/auth/register")
        .send({
          schoolName: `Limiter School ${uid()}`,
          adminName: "Limiter Admin",
          adminEmail: `limiter-${uid()}@example.com`,
          adminPassword: "password-123",
        })
        .expect(201);
    }
    const eleventh = await request(app)
      .post("/api/v1/auth/register")
      .send({
        schoolName: `Limiter School ${uid()}`,
        adminName: "Limiter Admin",
        adminEmail: `limiter-${uid()}@example.com`,
        adminPassword: "password-123",
      })
      .expect(429);
    expect(eleventh.body.error.code).toBe("RATE_LIMITED");

    // Forgot-password shares the bucket (one spam target, one budget) —
    // even a garbage email is refused once the budget is spent.
    const forgot = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: `nobody-${uid()}@example.com` });
    expect(forgot.status).toBe(429);
    expect(forgot.body.error.code).toBe("RATE_LIMITED");
  });
});
