import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Enquiry School ${uid()}`,
      adminName: "Enquiry Admin",
      adminEmail: `enquiry-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return { schoolId: res.body.data.school.id as string, slug: res.body.data.school.slug as string };
}

function enquiryBody(slug: string) {
  return {
    schoolSlug: slug,
    name: "Prospective Parent",
    phone: "+91-9876543210",
    email: `prospect-${uid()}@example.com`,
    message: "We are looking for Grade 6 admission for next session. Please share the fee structure.",
  };
}

describe("POST /api/v1/public/enquiries (§7 Phase 1 #10)", () => {
  it("stores a genuine enquiry and returns received", async () => {
    const { schoolId, slug } = await registerSchool();
    const before = await prisma.enquiry.count({ where: { schoolId } });

    const res = await request(app).post("/api/v1/public/enquiries").send(enquiryBody(slug)).expect(201);
    expect(res.body.data.received).toBe(true);
    expect(typeof res.body.data.id).toBe("string");
    expect(await prisma.enquiry.count({ where: { schoolId } })).toBe(before + 1);
  });

  it("accepts phone-only and email-only contacts, rejects neither-nor", async () => {
    const { slug } = await registerSchool();
    const base = enquiryBody(slug);

    const { phone, ...noPhone } = base;
    void phone;
    await request(app).post("/api/v1/public/enquiries").send(noPhone).expect(201);

    const { email, ...noEmail } = base;
    void email;
    await request(app).post("/api/v1/public/enquiries").send(noEmail).expect(201);

    const { phone: _p, email: _e, ...noContact } = base;
    void _p;
    void _e;
    const denied = await request(app).post("/api/v1/public/enquiries").send(noContact).expect(400);
    expect(denied.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("treats an empty phone string as missing when a valid email is present", async () => {
    const { slug } = await registerSchool();
    await request(app)
      .post("/api/v1/public/enquiries")
      .send({ ...enquiryBody(slug), phone: "" })
      .expect(201);
  });

  it("404s unknown school slugs and validates shape", async () => {
    const missing = await request(app)
      .post("/api/v1/public/enquiries")
      .send({ ...enquiryBody("school-that-does-not-exist"), email: `x-${uid()}@example.com` })
      .expect(404);
    expect(missing.body.error.code).toBe("SCHOOL_NOT_FOUND");

    const short = await request(app)
      .post("/api/v1/public/enquiries")
      .send({ schoolSlug: "x", name: "A", message: "hi" })
      .expect(400);
    expect(short.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("honeypots bots: fake success, zero rows stored", async () => {
    const { schoolId, slug } = await registerSchool();
    const before = await prisma.enquiry.count({ where: { schoolId } });

    const res = await request(app)
      .post("/api/v1/public/enquiries")
      .send({ ...enquiryBody(slug), website: "http://spam.example.com" })
      .expect(201);
    expect(res.body.data.received).toBe(true);
    expect(await prisma.enquiry.count({ where: { schoolId } })).toBe(before);
  });
});
