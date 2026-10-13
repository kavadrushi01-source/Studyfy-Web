import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";

// Ticket-creation limiter (§7 #27): 20/hour/account by default, keyed on
// the authenticated user (the founder's proxy decision rules out IP keys —
// same reasoning as login). This file exercises REAL limiter behavior, so
// it opts out of the NODE_ENV=test bypass BEFORE createApp() wires
// middleware (maybeLimit reads env once, at route setup), and drops the
// knob to 3 so the burst scenario stays quick. Everything restored after.
const SAVED_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
const SAVED_TICKET_LIMIT = process.env.TICKET_CREATE_LIMIT_MAX;
process.env.TICKET_CREATE_LIMIT_MAX = "3";
const SAVED_ACCOUNT_LIMIT = process.env.LOGIN_ACCOUNT_LIMIT_MAX;
delete process.env.LOGIN_ACCOUNT_LIMIT_MAX;
const SAVED_REGISTER_LIMIT = process.env.REGISTER_RATE_LIMIT_MAX;
delete process.env.REGISTER_RATE_LIMIT_MAX;
afterAll(() => {
  if (SAVED_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = SAVED_NODE_ENV;
  }
  if (SAVED_TICKET_LIMIT === undefined) {
    delete process.env.TICKET_CREATE_LIMIT_MAX;
  } else {
    process.env.TICKET_CREATE_LIMIT_MAX = SAVED_TICKET_LIMIT;
  }
  if (SAVED_ACCOUNT_LIMIT === undefined) {
    delete process.env.LOGIN_ACCOUNT_LIMIT_MAX;
  } else {
    process.env.LOGIN_ACCOUNT_LIMIT_MAX = SAVED_ACCOUNT_LIMIT;
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
      schoolName: `Ticket Limiter ${uid()}`,
      adminName: "Limiter Admin",
      adminEmail: `limiter-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    auth: { Authorization: `Bearer ${res.body.data.accessToken as string}` },
  };
}

describe("POST /api/v1/schools/:id/support/tickets creation limiter (§7 #27)", () => {
  it("caps one account at the limit, then 429s; other accounts stay open", async () => {
    const school = await newSchool();

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/support/tickets`)
        .set(school.auth)
        .send({ subject: `Burst ticket ${i}`, priority: "LOW" })
        .expect(201);
    }

    const blocked = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets`)
      .set(school.auth)
      .send({ subject: "One too many", priority: "LOW" })
      .expect(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");

    // Keyed per account: a different school's admin gets a fresh bucket.
    const other = await newSchool();
    await request(app)
      .post(`/api/v1/schools/${other.schoolId}/support/tickets`)
      .set(other.auth)
      .send({ subject: "Unaffected", priority: "LOW" })
      .expect(201);

    // Unauthenticated never reaches the limiter (401 first, no budget spent).
    await request(app).post(`/api/v1/schools/${school.schoolId}/support/tickets`).send({ subject: "Anon" }).expect(401);
  });
});
