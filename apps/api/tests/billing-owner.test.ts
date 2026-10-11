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

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string; adminEmail: string; adminId: string }> {
  const adminEmail = `billing-owner-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Billing Owner Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: adminEmail } } });
  return { schoolId, slug: res.body.data.school.slug as string, adminToken: res.body.data.accessToken as string, adminEmail, adminId: admin.id };
}

async function loginOwner(): Promise<string> {
  const email = `billing-owner-${uid()}@example.com`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
  await prisma.user.create({
    data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Billing Owner" },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
  return res.body.data.accessToken as string;
}

async function makeTeacher(schoolId: string): Promise<{ email: string; password: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
  const email = `billing-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Billing Teacher" },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  return { email, password };
}

describe("platform billing administration (§16.1)", () => {
  it("suspends a school: mirror + audit, tenant blocked, demo immune", async () => {
    const school = await registerSchool(`Billing Suspend School ${uid()}`);
    const ownerToken = await loginOwner();
    const auth = { Authorization: `Bearer ${ownerToken}` };

    const res = await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/suspend`)
      .set(auth)
      .send({ reason: "Non-payment" })
      .expect(200);
    expect(res.body.data.subscription.status).toBe("SUSPENDED");

    const mirror = await prisma.school.findUniqueOrThrow({ where: { id: school.schoolId } });
    expect(mirror.subscriptionStatus).toBe("SUSPENDED");
    const rows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "SUBSCRIPTION_STATUS_CHANGE" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).not.toBeNull();

    // Tenant access dies with data retained.
    await request(app).get(`/api/v1/schools/${school.schoolId}/students`).set({ Authorization: `Bearer ${school.adminToken}` }).expect(403);

    // Demo schools are immune.
    const demo = await registerSchool(`Billing Demo School ${uid()}`);
    await prisma.school.update({ where: { id: demo.schoolId }, data: { isDemo: true } });
    const refused = await request(app).post(`/api/v1/platform/schools/${demo.schoolId}/suspend`).set(auth).send({});
    expect(refused.status).toBe(403);
  });

  it("reactivates with an explicit period, changes plans, extends trials — all audited", async () => {
    const school = await registerSchool(`Billing Reactivate School ${uid()}`);
    const ownerToken = await loginOwner();
    const auth = { Authorization: `Bearer ${ownerToken}` };

    await request(app).post(`/api/v1/platform/schools/${school.schoolId}/suspend`).set(auth).send({}).expect(200);
    const re = await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/reactivate`)
      .set(auth)
      .send({ plan: "STANDARD", periodStart: "2026-11-01", periodEnd: "2026-11-30" })
      .expect(200);
    expect(re.body.data.subscription.status).toBe("ACTIVE");
    expect((await prisma.school.findUniqueOrThrow({ where: { id: school.schoolId } })).subscriptionStatus).toBe("ACTIVE");

    const plan = await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/plan`)
      .set(auth)
      .send({ plan: "PREMIUM" })
      .expect(200);
    expect(plan.body.data.subscription.plan).toBe("PREMIUM");
    expect((await prisma.school.findUniqueOrThrow({ where: { id: school.schoolId } })).plan).toBe("PREMIUM");
    const planRows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "SUBSCRIPTION_PLAN_CHANGE" } });
    expect(planRows).toHaveLength(1);

    const ext = await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/trial-extension`)
      .set(auth)
      .send({ trialEndsAt: "2027-01-31" })
      .expect(200);
    expect(new Date(ext.body.data.trialEndsAt as string).toISOString().slice(0, 10)).toBe("2027-01-31");
    const past = await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/trial-extension`)
      .set(auth)
      .send({ trialEndsAt: "2020-01-01" });
    expect(past.status).toBe(400);

    const missing = await request(app).post("/api/v1/platform/schools/nope/suspend").set(auth).send({});
    expect(missing.status).toBe(404);
  });

  it("refuses tenant admins on platform billing routes", async () => {
    const school = await registerSchool(`Billing Refusal School ${uid()}`);
    const res = await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/suspend`)
      .set({ Authorization: `Bearer ${school.adminToken}` })
      .send({});
    expect(res.status).toBe(403);
  });
});

describe("suspended-school exception (§13.4, both directions)", () => {
  it("lets the suspended admin log in and reach billing paths only; everyone else stays blocked", async () => {
    const school = await registerSchool(`Billing Exception School ${uid()}`);
    const ownerToken = await loginOwner();
    const teacher = await makeTeacher(school.schoolId);
    await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/suspend`)
      .set({ Authorization: `Bearer ${ownerToken}` })
      .send({})
      .expect(200);

    // Admin logs in (the exception); teacher and strangers do not.
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ schoolSlug: school.slug, email: school.adminEmail, password: "password-123" })
      .expect(200);
    const adminToken = adminLogin.body.data.accessToken as string;
    const teacherLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ schoolSlug: school.slug, email: teacher.email, password: teacher.password });
    expect(teacherLogin.status).toBe(403);
    expect(teacherLogin.body.error.code).toBe("SCHOOL_SUSPENDED");
    const strangerLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ schoolSlug: school.slug, email: `nobody-${uid()}@example.com`, password: "password-123" });
    expect(strangerLogin.status).toBe(401);

    // Admin on a real route: 403. Admin on a billing path: passes the gate
    // (no billing routes exist yet — 404 proves pass-through, not denial;
    // this assertion becomes a 200 journey when the billing router lands).
    const blocked = await request(app)
      .get(`/api/v1/schools/${school.schoolId}/students`)
      .set({ Authorization: `Bearer ${adminToken}` });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("SCHOOL_SUSPENDED");
    const billing = await request(app)
      .get(`/api/v1/schools/${school.schoolId}/billing/overview`)
      .set({ Authorization: `Bearer ${adminToken}` });
    expect(billing.status).toBe(404);

    // Teacher login itself is refused on a suspended school (admin-only).
    expect(teacherLogin.status).toBe(403);
  });
});
