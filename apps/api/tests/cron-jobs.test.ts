import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { setMailer, stubMailer, type FeeReminderEmail } from "../src/lib/mailer.js";
import { runFeeRemindersJob } from "../src/modules/jobs/jobs.service.js";
import { schoolHour } from "../src/lib/school-time.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

// 32+ chars — the middleware refuses anything shorter, even in tests.
const TEST_CRON_SECRET = "test-cron-secret-0123456789abcdef";
const savedSecret = process.env.CRON_SECRET;

function uid(): string {
  return randomUUID().slice(0, 8);
}

const emailed: FeeReminderEmail[] = [];

beforeAll(() => {
  process.env.CRON_SECRET = TEST_CRON_SECRET;
  setMailer({
    ...stubMailer,
    sendFeeReminder: async (email: FeeReminderEmail) => {
      emailed.push(email);
    },
  });
});

afterAll(() => {
  if (savedSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = savedSecret;
  }
  setMailer(null);
});

async function registerSchool(name: string): Promise<{ schoolId: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: name,
      adminName: "Cron Test Admin",
      adminEmail: `cron-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return { schoolId: res.body.data.school.id as string, adminToken: res.body.data.accessToken as string };
}

async function dueInvoice(schoolId: string): Promise<{ guardianEmail: string }> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
  const parentRole = await prisma.role.findUniqueOrThrow({ where: { name: "PARENT" } });
  const studentUser = await prisma.user.create({
    data: { schoolId, roleId: studentRole.id, email: `cron-student-${uid()}@example.com`, passwordHash: "x", name: "Cron Student" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: studentUser.id, sectionId: section.id } });
  const parent = await prisma.user.create({
    data: { schoolId, roleId: parentRole.id, email: `cron-guardian-${uid()}@example.com`, passwordHash: "x", name: "Cron Parent" },
  });
  await prisma.studentGuardian.create({
    data: { schoolId, studentId: student.id, parentId: parent.id, relationship: "Mother" },
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
  return { guardianEmail: parent.email };
}

// 03:30 UTC is 09:00 in Asia/Kolkata (IST, no DST) — the job's sending
// hour — and 23:30 the previous day in New York — not it. One instant
// exercises both the process and the skip paths deterministically.
const NINE_AM_IST = new Date("2026-10-12T03:30:00Z");

describe("cron authentication (§13.4 fourth path)", () => {
  it("refuses with 503 when CRON_SECRET is unset — never open", async () => {
    delete process.env.CRON_SECRET;
    try {
      const res = await request(app)
        .post("/api/v1/internal/jobs/fee-reminders")
        .set("X-Cron-Secret", TEST_CRON_SECRET);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("JOBS_DISABLED");
    } finally {
      process.env.CRON_SECRET = TEST_CRON_SECRET;
    }
  });

  it("refuses a wrong secret and a missing secret with 401", async () => {
    const wrong = await request(app)
      .post("/api/v1/internal/jobs/fee-reminders")
      .set("X-Cron-Secret", "wrong-secret-that-is-long-enough-000");
    expect(wrong.status).toBe(401);

    const missing = await request(app).post("/api/v1/internal/jobs/fee-reminders");
    expect(missing.status).toBe(401);
  });

  it("grants nothing to a user JWT without the secret", async () => {
    const school = await registerSchool(`Cron JWT School ${uid()}`);
    const res = await request(app)
      .post("/api/v1/internal/jobs/fee-reminders")
      .set("Authorization", `Bearer ${school.adminToken}`);
    expect(res.status).toBe(401);
  });

  it("serves the job with the secret and NO user auth (scheduler path)", async () => {
    const res = await request(app)
      .post("/api/v1/internal/jobs/fee-reminders")
      .set("X-Cron-Secret", TEST_CRON_SECRET)
      .expect(200);
    expect(res.body.data.job).toBe("fee-reminders");
    expect(typeof res.body.data.emailed).toBe("number");
    expect(typeof res.body.data.schoolsChecked).toBe("number");
  });

  it("answers 404 on an unknown job name", async () => {
    const res = await request(app)
      .post("/api/v1/internal/jobs/warm-the-pool")
      .set("X-Cron-Secret", TEST_CRON_SECRET);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("UNKNOWN_JOB");
  });
});

describe("fee-reminders job (§12.4 per-school hours + idempotency)", () => {
  it("resolves school-local hours (9 in IST, 23 in New York, same instant)", () => {
    expect(schoolHour("Asia/Kolkata", NINE_AM_IST)).toBe(9);
    expect(schoolHour("America/New_York", NINE_AM_IST)).toBe(23);
  });

  it("processes the 9am school, skips the wrong-hour, suspended and demo schools — and repeats send nothing", async () => {
    const nineAm = await registerSchool(`Cron Nine School ${uid()}`);
    await prisma.school.update({ where: { id: nineAm.schoolId }, data: { timezone: "Asia/Kolkata" } });
    const nineGuardian = await dueInvoice(nineAm.schoolId);

    const wrongHour = await registerSchool(`Cron Night School ${uid()}`);
    await prisma.school.update({ where: { id: wrongHour.schoolId }, data: { timezone: "America/New_York" } });
    await dueInvoice(wrongHour.schoolId);

    const suspended = await registerSchool(`Cron Suspended School ${uid()}`);
    await prisma.school.update({
      where: { id: suspended.schoolId },
      data: { timezone: "Asia/Kolkata", subscriptionStatus: "SUSPENDED" },
    });
    await dueInvoice(suspended.schoolId);

    const demo = await registerSchool(`Cron Demo School ${uid()}`);
    await prisma.school.update({ where: { id: demo.schoolId }, data: { timezone: "Asia/Kolkata", isDemo: true } });
    await dueInvoice(demo.schoolId);

    // Assertions are per-school (stamps + own guardian's mail), never
    // global counts: the test DB is shared with every other test file, and
    // the sweep is targeted at exactly this test's four schools (opts
    // param) so other files' accumulated rows can't slow it down or leak
    // into counts — order-dependent either way, isolated by construction.
    const scope = { schoolIds: [nineAm.schoolId, wrongHour.schoolId, suspended.schoolId, demo.schoolId] };
    emailed.length = 0;
    const first = await runFeeRemindersJob(prisma, NINE_AM_IST, scope);
    // Three checked, not four: the demo school is excluded by the
    // isDemo=false selector itself (first guard — its unstamped invoice
    // below proves the second guard never even needed to fire).
    expect(first.schoolsChecked).toBe(3);
    expect(first.schoolsProcessed).toBe(1);
    expect(first.schoolsSkippedHour).toBe(1);
    expect(first.schoolsSkippedSuspended).toBe(1);
    expect(emailed.filter((e) => e.to === nineGuardian.guardianEmail)).toHaveLength(1);
    const nineStamped = await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId: nineAm.schoolId } });
    expect(nineStamped.lastReminderAt).not.toBeNull();

    const nightStamped = await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId: wrongHour.schoolId } });
    expect(nightStamped.lastReminderAt).toBeNull();
    const suspendedStamped = await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId: suspended.schoolId } });
    expect(suspendedStamped.lastReminderAt).toBeNull();
    const demoStamped = await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId: demo.schoolId } });
    expect(demoStamped.lastReminderAt).toBeNull();

    // The run still reports its partition honestly (every checked non-demo
    // school lands in exactly one bucket).
    expect(first.schoolsChecked).toBe(first.schoolsProcessed + first.schoolsSkippedHour + first.schoolsSkippedSuspended);

    // A repeated trigger (scheduler retry) re-sends nothing: the
    // lastReminderAt stamp is the "already done" record.
    emailed.length = 0;
    await runFeeRemindersJob(prisma, NINE_AM_IST, scope);
    expect(emailed.filter((e) => e.to === nineGuardian.guardianEmail)).toHaveLength(0);
  }, 60000);
});
