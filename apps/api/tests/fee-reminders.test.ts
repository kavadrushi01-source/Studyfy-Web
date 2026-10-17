import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { setMailer, stubMailer, type FeeReminderEmail } from "../src/lib/mailer.js";
import { runFeeReminders } from "../src/modules/fees/fees.service.js";

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
      return "sent";
    },
  });
});

afterAll(() => {
  setMailer(null);
});

async function registerSchool(): Promise<{ schoolId: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Reminder School ${uid()}`,
      adminName: "Reminder Admin",
      adminEmail: `reminder-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return { schoolId: res.body.data.school.id as string, adminToken: res.body.data.accessToken as string };
}

async function invoiceFor(
  schoolId: string,
  dueDate: string,
  status: "PENDING" | "PAID" = "PENDING",
): Promise<{ guardianEmail: string }> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const studentRole = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  const parentRole = await prisma.role.findUnique({ where: { name: "PARENT" } });
  if (!studentRole || !parentRole) {
    throw new Error("Roles must be seeded");
  }
  const studentUser = await prisma.user.create({
    data: {
      schoolId,
      roleId: studentRole.id,
      email: `reminder-student-${uid()}@example.com`,
      passwordHash: "x",
      name: "Reminder Student",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: studentUser.id, sectionId: section.id } });
  const guardianEmail = `reminder-guardian-${uid()}@example.com`;
  const parent = await prisma.user.create({
    data: { schoolId, roleId: parentRole.id, email: guardianEmail, passwordHash: "x", name: "Reminder Parent" },
  });
  await prisma.studentGuardian.create({
    data: { schoolId, studentId: student.id, parentId: parent.id, relationship: "Father" },
  });
  const structure = await prisma.feeStructure.create({
    data: { schoolId, classId: cls.id, name: "Term 1 Tuition", amount: 5000, term: "Term 1", category: "TUITION" },
  });
  await prisma.feeInvoice.create({
    data: {
      schoolId,
      studentId: student.id,
      structureId: structure.id,
      amount: 5000,
      amountPaid: status === "PAID" ? 5000 : 0,
      status,
      dueDate: new Date(`${dueDate}T00:00:00Z`),
    },
  });
  return { guardianEmail };
}

describe("fee reminders (§7 Phase 1 #3, §12.7 timezones)", () => {
  it("emails overdue guardians, stays silent on paid, and never double-reminds one day", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const overdue = await invoiceFor(schoolId, "2000-01-01");
    await invoiceFor(schoolId, "2000-01-01", "PAID");
    emailed.length = 0;

    const first = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/reminders/run`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(first.body.data.emailed).toBe(1);
    expect(emailed.map((e) => e.to)).toEqual([overdue.guardianEmail]);

    // Past-due unpaid rows are marked OVERDUE by the run; settled rows stay PAID.
    expect((await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId, amountPaid: 0 } })).status).toBe("OVERDUE");
    expect((await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId, amountPaid: 5000 } })).status).toBe("PAID");

    const second = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/reminders/run`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(second.body.data.emailed).toBe(0);
    expect(emailed).toHaveLength(1);
  });

  it("does not stamp failed sends, so the next run can retry them", async () => {
    const { schoolId } = await registerSchool();
    await invoiceFor(schoolId, "2000-01-01");
    emailed.length = 0;
    setMailer({
      ...stubMailer,
      sendFeeReminder: async () => {
        throw new Error("SMTP relay down");
      },
    });
    try {
      const failed = await runFeeReminders(prisma, schoolId);
      expect(failed.emailed).toBe(0);
      const invoices = await prisma.feeInvoice.findMany({ where: { schoolId } });
      expect(invoices.length).toBeGreaterThan(0);
      for (const invoice of invoices) {
        expect(invoice.lastReminderAt).toBeNull();
      }
    } finally {
      setMailer({
        ...stubMailer,
        sendFeeReminder: async (email: FeeReminderEmail) => {
          emailed.push(email);
          return "sent";
        },
      });
    }

    const retried = await runFeeReminders(prisma, schoolId);
    expect(retried.emailed).toBe(1);
    expect(emailed).toHaveLength(1);
  });

  it("reminds rows already sitting in OVERDUE status (not just PENDING)", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const overdue = await invoiceFor(schoolId, "2000-01-01");
    await prisma.feeInvoice.updateMany({ where: { schoolId }, data: { status: "OVERDUE" } });
    emailed.length = 0;

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/reminders/run`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.data.emailed).toBe(1);
    expect(emailed.map((e) => e.to)).toEqual([overdue.guardianEmail]);
  });

  it("judges due/overdue by the SCHOOL's calendar day, not server UTC", async () => {
    // Fixed instant: 2026-09-17 10:00 UTC.
    const now = new Date("2026-09-17T10:00:00Z");
    // Kiritimati (+14) already lives on 2026-09-18: a 09-17 due date is OVERDUE.
    const { schoolId: kiriId } = await registerSchool();
    await prisma.school.update({ where: { id: kiriId }, data: { timezone: "Pacific/Kiritimati" } });
    await invoiceFor(kiriId, "2026-09-17");
    // Kolkata (+5:30) still lives on 2026-09-17: same due date is due TODAY.
    const { schoolId: kolId } = await registerSchool();
    await prisma.school.update({ where: { id: kolId }, data: { timezone: "Asia/Kolkata" } });
    await invoiceFor(kolId, "2026-09-17");
    emailed.length = 0;

    await runFeeReminders(prisma, kiriId, now);
    await runFeeReminders(prisma, kolId, now);

    expect(emailed).toHaveLength(2);
    const overdue = emailed.find((e) => e.daysOverdue > 0);
    const dueToday = emailed.find((e) => e.daysOverdue === 0);
    expect(overdue?.daysOverdue).toBe(1);
    expect(dueToday?.daysOverdue).toBe(0);
  });

  it("skips suspended schools and unauthenticated callers", async () => {
    const { schoolId, adminToken } = await registerSchool();
    await invoiceFor(schoolId, "2000-01-01");
    await prisma.school.update({ where: { id: schoolId }, data: { subscriptionStatus: "SUSPENDED" } });
    emailed.length = 0;

    // tenantMiddleware's own subscription gate fires first with 403 — the
    // service-level skip covers direct (cron) invocations past the gate.
    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/fees/reminders/run`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);
    expect(res.body.error.code).toBe("SCHOOL_SUSPENDED");
    expect(emailed).toHaveLength(0);

    await request(app).post(`/api/v1/schools/${schoolId}/fees/reminders/run`).expect(401);
  });
});
