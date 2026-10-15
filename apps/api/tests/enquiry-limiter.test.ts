import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";

// Enquiry limiter (§13.5): 5 per 15 min per IP on the public form — the
// spam target. This file exercises REAL limiter behavior, so it opts out
// of the NODE_ENV=test bypass BEFORE createApp() wires middleware
// (maybeLimit reads env once, at route setup). Defaults apply (no knob
// overrides) — the exact production budget. Everything restored after.
const SAVED_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
const SAVED_ENQUIRY_LIMIT = process.env.ENQUIRY_RATE_LIMIT_MAX;
delete process.env.ENQUIRY_RATE_LIMIT_MAX;
afterAll(() => {
  if (SAVED_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = SAVED_NODE_ENV;
  }
  if (SAVED_ENQUIRY_LIMIT === undefined) {
    delete process.env.ENQUIRY_RATE_LIMIT_MAX;
  } else {
    process.env.ENQUIRY_RATE_LIMIT_MAX = SAVED_ENQUIRY_LIMIT;
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

describe("enquiry limiter (§13.5)", () => {
  it("fills the 5/15min budget, then refuses the 6th", async () => {
    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        schoolName: `Enquiry Limiter ${uid()}`,
        adminName: "Limiter Admin",
        adminEmail: `enquiry-limiter-${uid()}@example.com`,
        adminPassword: "password-123",
      })
      .expect(201);
    const slug = (reg.body as { data: { school: { slug: string } } }).data.school.slug;
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post("/api/v1/public/enquiries")
        .send({
          schoolSlug: slug,
          name: `Parent ${i}`,
          phone: "9111111111",
          message: "Admissions enquiry, please call back soon.",
        })
        .expect(201);
    }
    const sixth = await request(app)
      .post("/api/v1/public/enquiries")
      .send({ schoolSlug: slug, name: "Parent 6", phone: "9111111111", message: "Admissions enquiry, please call back soon." })
      .expect(429);
    expect(sixth.body.error.code).toBe("RATE_LIMITED");
  });
});
