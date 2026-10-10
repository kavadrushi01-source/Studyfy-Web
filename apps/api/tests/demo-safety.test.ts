import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { setMailer, stubMailer, type FeeReminderEmail } from "../src/lib/mailer.js";
import { runFeeReminders } from "../src/modules/fees/fees.service.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

const emailed: FeeReminderEmail[] = [];

beforeAll(() => {
  setMailer({
    ...stubMailer,
    sendFeeReminder: async (email: FeeReminderEmail) => {
      emailed.push(email);
    },
  });
});

afterAll(() => {
  setMailer(null);
});

async function registerSchool(name: string): Promise<{ schoolId: string; slug: string; adminEmail: string }> {
  const adminEmail = `demo-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: name,
      adminName: "Demo Test Admin",
      adminEmail,
      adminPassword: "password-123",
    })
    .expect(201);
  return { schoolId: res.body.data.school.id as string, slug: res.body.data.school.slug as string, adminEmail };
}

async function dueInvoice(schoolId: string): Promise<void> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
  const parentRole = await prisma.role.findUniqueOrThrow({ where: { name: "PARENT" } });
  const studentUser = await prisma.user.create({
    data: { schoolId, roleId: studentRole.id, email: `demo-student-${uid()}@example.com`, passwordHash: "x", name: "Demo Student" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: studentUser.id, sectionId: section.id } });
  const parent = await prisma.user.create({
    data: { schoolId, roleId: parentRole.id, email: `demo-guardian-${uid()}@example.com`, passwordHash: "x", name: "Demo Parent" },
  });
  await prisma.studentGuardian.create({
    data: { schoolId, studentId: student.id, parentId: parent.id, relationship: "Father" },
  });
  const structure = await prisma.feeStructure.create({
    data: { schoolId, classId: cls.id, name: "Term 1 Tuition", amount: 5000, term: "Term 1", category: "TUITION" },
  });
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await prisma.feeInvoice.create({
    data: {
      schoolId,
      studentId: student.id,
      structureId: structure.id,
      amount: 5000,
      amountPaid: 0,
      status: "PENDING",
      dueDate: new Date(`${yesterday}T00:00:00Z`),
    },
  });
}

describe("demo-school billing exemption (§13.11, §13.4)", () => {
  it("lets a SUSPENDED demo school keep working, while a real suspended school is blocked", async () => {
    const demo = await registerSchool(`Demo Exempt School ${uid()}`);
    await prisma.school.update({ where: { id: demo.schoolId }, data: { isDemo: true, subscriptionStatus: "SUSPENDED" } });

    // Login works despite SUSPENDED …
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: demo.adminEmail, password: "password-123", schoolSlug: demo.slug })
      .expect(200);
    // … and tenant routes serve normally.
    await request(app)
      .get(`/api/v1/schools/${demo.schoolId}/students`)
      .set("Authorization", `Bearer ${login.body.data.accessToken as string}`)
      .expect(200);

    const real = await registerSchool(`Real Suspended School ${uid()}`);
    await prisma.school.update({ where: { id: real.schoolId }, data: { subscriptionStatus: "SUSPENDED" } });
    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: real.adminEmail, password: "password-123", schoolSlug: real.slug });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("SCHOOL_SUSPENDED");
  });

  it("lets a trial-lapsed demo school keep working, while a real lapsed trial is blocked", async () => {
    const demo = await registerSchool(`Demo Trial School ${uid()}`);
    await prisma.school.update({
      where: { id: demo.schoolId },
      data: { isDemo: true, trialEndsAt: new Date(Date.now() - 60 * 1000) },
    });
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: demo.adminEmail, password: "password-123", schoolSlug: demo.slug })
      .expect(200);

    const real = await registerSchool(`Real Lapsed School ${uid()}`);
    await prisma.school.update({ where: { id: real.schoolId }, data: { trialEndsAt: new Date(Date.now() - 60 * 1000) } });
    const blocked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: real.adminEmail, password: "password-123", schoolSlug: real.slug });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("TRIAL_EXPIRED");
  });
});

describe("demo outbound-mail suppression (§13.11)", () => {
  it("logs instead of sending for a demo school, stamps idempotency, and never double-sends", async () => {
    const demo = await registerSchool(`Demo Quiet School ${uid()}`);
    await prisma.school.update({ where: { id: demo.schoolId }, data: { isDemo: true } });
    await dueInvoice(demo.schoolId);

    emailed.length = 0;
    const first = await runFeeReminders(prisma, demo.schoolId);
    expect(first.emailed).toBe(0);
    expect(first.skipped).toBe(1);
    expect(emailed).toHaveLength(0);

    const stamped = await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId: demo.schoolId } });
    expect(stamped.lastReminderAt).not.toBeNull();

    const second = await runFeeReminders(prisma, demo.schoolId);
    expect(second.emailed).toBe(0);
    expect(emailed).toHaveLength(0);
  });

  it("still emails a REAL school (suppression is demo-only)", async () => {
    const real = await registerSchool(`Real Loud School ${uid()}`);
    await dueInvoice(real.schoolId);

    emailed.length = 0;
    const run = await runFeeReminders(prisma, real.schoolId);
    expect(run.emailed).toBe(1);
    expect(emailed).toHaveLength(1);
  });
});
