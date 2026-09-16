import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

describe("hardening (spec §13.5, RULES.md §4)", () => {
  it("sends helmet security headers and no stack traces", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.body).toEqual({ success: true, data: { ok: true }, error: null, meta: null });
  });

  it("reflects the configured frontend origin and blocks unknown ones", async () => {
    const allowed = await request(app).get("/health").set("Origin", "http://localhost:3000").expect(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");

    const blocked = await request(app).get("/health").set("Origin", "https://evil.example").expect(200);
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does NOT rate-limit under NODE_ENV=test (suite must exercise auth freely)", async () => {
    // Six rapid logins would trip the production limiter (5/15min). Here
    // every attempt must pass the limiter (401s are fine — wrong password).
    for (let i = 0; i < 6; i += 1) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "nobody@example.com", password: "wrong", schoolSlug: `nope-${i}` });
      expect(res.status).not.toBe(429);
    }
  });

  it("stores a real enquiry and silently drops honeypot spam", async () => {
    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        schoolName: `Enquiry School ${uid()}`,
        adminName: "Enquiry Admin",
        adminEmail: `enquiry-admin-${uid()}@example.com`,
        adminPassword: "password-123",
      })
      .expect(201);
    const slug = reg.body.data.school.slug as string;
    const schoolId = reg.body.data.school.id as string;

    const real = await request(app)
      .post("/api/v1/public/enquiries")
      .send({
        schoolSlug: slug,
        name: "Prospective Parent",
        phone: "9876543210",
        message: "What is the admission process for Grade 1 next year?",
      })
      .expect(201);
    expect(real.body.data.received).toBe(true);
    const stored = await prisma.enquiry.findFirst({ where: { schoolId, name: "Prospective Parent" } });
    expect(stored?.message).toContain("admission process");

    const before = await prisma.enquiry.count({ where: { schoolId } });
    const spam = await request(app)
      .post("/api/v1/public/enquiries")
      .send({
        schoolSlug: slug,
        name: "Bot",
        phone: "000",
        message: "Buy cheap watches now free money click here please.",
        website: "https://spam.example",
      })
      .expect(201);
    expect(spam.body.data.received).toBe(true);
    // Fake success — nothing stored.
    expect(await prisma.enquiry.count({ where: { schoolId } })).toBe(before);
  });

  it("validates enquiries (contact required, message length)", async () => {
    const res = await request(app)
      .post("/api/v1/public/enquiries")
      .send({ schoolSlug: "school-of-science", name: "No Contact", message: "This message is long enough." })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
