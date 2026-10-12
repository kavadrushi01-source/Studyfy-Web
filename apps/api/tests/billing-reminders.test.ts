import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { setMailer, stubMailer, type SubscriptionInvoiceReminderEmail, type TrialEndingEmail } from "../src/lib/mailer.js";
import { runBillingCycleJob } from "../src/modules/jobs/jobs.service.js";
import {
  issueInvoice,
  markInvoicePaid,
  runBillingReminders,
  startOfDayUtc,
} from "../src/modules/billing/billing.service.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

// 32+ chars — the middleware refuses anything shorter, even in tests.
const TEST_CRON_SECRET = "test-cron-secret-0123456789abcdef";
const savedSecret = process.env.CRON_SECRET;

function uid(): string {
  return randomUUID().slice(0, 8);
}

const trialSent: TrialEndingEmail[] = [];
const invoiceSent: SubscriptionInvoiceReminderEmail[] = [];

beforeAll(() => {
  process.env.CRON_SECRET = TEST_CRON_SECRET;
  setMailer({
    ...stubMailer,
    sendTrialEndingReminder: async (email: TrialEndingEmail) => {
      trialSent.push(email);
      return "sent";
    },
    sendSubscriptionInvoiceReminder: async (email: SubscriptionInvoiceReminderEmail) => {
      invoiceSent.push(email);
      return "sent";
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

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string; adminEmail: string; adminId: string }> {
  const adminEmail = `billing-remind-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Billing Remind Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: adminEmail } } });
  return { schoolId, slug: res.body.data.school.slug as string, adminToken: res.body.data.accessToken as string, adminEmail, adminId: admin.id };
}

async function setTrial(schoolId: string, trialEndsAt: Date): Promise<void> {
  await prisma.school.update({ where: { id: schoolId }, data: { subscriptionStatus: "TRIAL", trialEndsAt } });
}

// Fixed clock: deterministic daysLeft/daysOverdue math, independent of the
// wall clock (other files' fixtures sit at other dates and never match the
// 3/1/7 reminder days against THIS instant).
const NOW = new Date("2026-11-10T00:00:00Z");
const day = (offset: number): Date => new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);

async function overdueInvoice(schoolId: string, adminId: string, periodEnd: Date, spanDays = 27): Promise<string> {
  const periodStart = startOfDayUtc(new Date(periodEnd.getTime() - spanDays * 24 * 60 * 60 * 1000));
  const issued = await issueInvoice(
    prisma,
    schoolId,
    { plan: "BASIC", periodStart, periodEnd: startOfDayUtc(periodEnd), schoolState: null, platformState: null },
    adminId,
  );
  return issued.id;
}

describe("billing reminders (§12.4 + §16.1, clock-driven)", () => {
  it("mails trial-ending nudges at 3 and 1 days, never twice, never off-day", async () => {
    const tag = uid();
    const three = await registerSchool(`Remind Trial3 ${tag}`);
    const one = await registerSchool(`Remind Trial1 ${tag}`);
    const five = await registerSchool(`Remind Trial5 ${tag}`);
    await setTrial(three.schoolId, day(3));
    await setTrial(one.schoolId, day(1));
    await setTrial(five.schoolId, day(5));
    const ids = [three.schoolId, one.schoolId, five.schoolId];

    trialSent.length = 0;
    const first = await runBillingReminders(prisma, NOW, { schoolIds: ids });
    expect(first.trialReminded).toBe(2);
    expect(trialSent).toHaveLength(2);
    const byEmail = new Map(trialSent.map((e) => [e.to, e]));
    expect(byEmail.get(three.adminEmail)?.daysLeft).toBe(3);
    expect(byEmail.get(three.adminEmail)?.trialEndDate).toBe("2026-11-13");
    expect(byEmail.get(three.adminEmail)?.schoolName).toBe(`Remind Trial3 ${tag}`);
    expect(byEmail.get(one.adminEmail)?.daysLeft).toBe(1);
    expect(byEmail.get(one.adminEmail)?.schoolName).toBe(`Remind Trial1 ${tag}`);
    expect(byEmail.has(five.adminEmail)).toBe(false);

    // Same instant again: audit-as-sent-log suppresses every resend.
    const second = await runBillingReminders(prisma, NOW, { schoolIds: ids });
    expect(second.trialReminded).toBe(0);
    expect(trialSent).toHaveLength(2);

    const rows = await prisma.auditLog.findMany({ where: { action: "SUBSCRIPTION_TRIAL_REMINDER" } });
    const ours = rows.filter((r) => ids.includes(r.schoolId ?? ""));
    expect(ours).toHaveLength(2);
    expect(ours.every((r) => r.actorId === null)).toBe(true);
  });

  it("never mails demo schools — no mail, no audit, no transition", async () => {
    const demo = await registerSchool(`Remind Demo ${uid()}`);
    await prisma.school.update({ where: { id: demo.schoolId }, data: { isDemo: true } });
    await setTrial(demo.schoolId, day(3));

    trialSent.length = 0;
    const run = await runBillingReminders(prisma, NOW, { schoolIds: [demo.schoolId] });
    expect(run.trialReminded).toBe(0);
    expect(trialSent).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { schoolId: demo.schoolId, action: "SUBSCRIPTION_TRIAL_REMINDER" } })).toBe(0);
  });

  it("mails overdue invoices at 1 and 7 days, skips the rest, never twice", async () => {
    const school = await registerSchool(`Remind Overdue ${uid()}`);
    const oneDay = await overdueInvoice(school.schoolId, school.adminId, day(-1));
    const sevenDay = await overdueInvoice(school.schoolId, school.adminId, day(-7));
    const threeDay = await overdueInvoice(school.schoolId, school.adminId, day(-3));
    // Same overdue day as oneDay but a distinct period (issuance is
    // period-keyed — same start would idempotently return oneDay's row),
    // then paid: overdue AND settled, mailed to nobody.
    const paid = await overdueInvoice(school.schoolId, school.adminId, day(-1), 20);
    await markInvoicePaid(prisma, paid, school.adminId);

    invoiceSent.length = 0;
    const first = await runBillingReminders(prisma, NOW, { schoolIds: [school.schoolId] });
    expect(first.invoiceReminded).toBe(2);
    const byInvoice = new Map(invoiceSent.map((e) => [e.invoiceNumber, e]));
    expect(byInvoice.size).toBe(2);
    const days = invoiceSent.map((e) => e.daysOverdue).sort();
    expect(days).toEqual([1, 7]);
    expect(invoiceSent.every((e) => e.to === school.adminEmail)).toBe(true);

    const second = await runBillingReminders(prisma, NOW, { schoolIds: [school.schoolId] });
    expect(second.invoiceReminded).toBe(0);
    expect(invoiceSent).toHaveLength(2);

    const rows = await prisma.auditLog.findMany({ where: { action: "SUBSCRIPTION_INVOICE_REMINDER" } });
    const ours = rows.filter((r) => r.schoolId === school.schoolId);
    expect(ours).toHaveLength(2);
    expect(ours.every((r) => r.actorId === null)).toBe(true);
    // The 3-day and PAID invoices were mailed to nobody: only the 1-day and
    // 7-day invoice numbers appear in the sent mail.
    const threeDayNumber = (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: threeDay } })).invoiceNumber;
    const paidNumber = (await prisma.subscriptionInvoice.findUniqueOrThrow({ where: { id: paid } })).invoiceNumber;
    const sentNumbers = invoiceSent.map((e) => e.invoiceNumber);
    expect(sentNumbers).not.toContain(threeDayNumber);
    expect(sentNumbers).not.toContain(paidNumber);
    expect(oneDay).not.toBe(sevenDay);
  });

  it("double-runs the whole job with the clock forward: transitions once, mails once, second run silent", async () => {
    const lapsed = await registerSchool(`Remind Lapsed ${uid()}`);
    const soon = await registerSchool(`Remind Soon ${uid()}`);
    await setTrial(lapsed.schoolId, day(-1));
    await setTrial(soon.schoolId, day(3));
    const ids = [lapsed.schoolId, soon.schoolId];

    trialSent.length = 0;
    invoiceSent.length = 0;
    const first = await runBillingCycleJob(prisma, NOW, { schoolIds: ids });
    expect(first.job).toBe("billing-cycle");
    expect(first.cycle.transitioned).toEqual([{ schoolId: lapsed.schoolId, from: "TRIAL", to: "PAST_DUE" }]);
    expect(first.cycle.invoicesIssued).toBe(1);
    expect(first.reminders.trialReminded).toBe(1);
    expect(trialSent.map((e) => e.to)).toEqual([soon.adminEmail]);

    const second = await runBillingCycleJob(prisma, NOW, { schoolIds: ids });
    expect(second.cycle.transitioned).toEqual([]);
    expect(second.cycle.invoicesIssued).toBe(0);
    expect(second.reminders.trialReminded).toBe(0);
    expect(second.reminders.invoiceReminded).toBe(0);
    expect(trialSent).toHaveLength(1);
    expect(invoiceSent).toHaveLength(0);

    expect((await prisma.school.findUniqueOrThrow({ where: { id: lapsed.schoolId } })).subscriptionStatus).toBe("PAST_DUE");
  });

  // The HTTP path sweeps the whole shared test DB (no targeting param on
  // the route by design) — under parallel-worker load that can exceed the
  // 20s default, same lesson as the fee-reminders endpoint test.
  it("serves billing-cycle on the §12.4 route with the secret", { timeout: 60000 }, async () => {
    // Shape-only: the route sweeps the whole shared test DB by design (like
    // the fee-reminders endpoint test), so this asserts wiring — never
    // fixture counts. Service-level tests above pin the behavior.
    const res = await request(app)
      .post("/api/v1/internal/jobs/billing-cycle")
      .set("X-Cron-Secret", TEST_CRON_SECRET)
      .expect(200);
    expect(res.body.data.job).toBe("billing-cycle");
    expect(typeof res.body.data.cycle.schoolsChecked).toBe("number");
    expect(Array.isArray(res.body.data.cycle.transitioned)).toBe(true);
    expect(typeof res.body.data.reminders.trialReminded).toBe("number");
  });
});
