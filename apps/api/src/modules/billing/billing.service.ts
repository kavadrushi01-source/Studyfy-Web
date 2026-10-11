import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { pickAuditFields, recordAudit } from "../../lib/audit.js";
import { AuthError } from "../auth/auth.service.js";
import { GRACE_DAYS, GST_PERCENT, PLANS, type SchoolPlan } from "./plans.js";

// ---------------------------------------------------------------------------
// Pure date/money helpers (§16.1) — unit-tested without a database.
// ---------------------------------------------------------------------------

// Financial year for per-FY invoice numbering (India: April–March).
// "2026-27": April 2026..March 2027. UTC calendar — money periods are not
// school days (§12.7 is for attendance/fees-due, not for tax years).
export function financialYear(d: Date): string {
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear();
  const start = month >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// Short GST-safe invoice numbers: STY/26-27/0001 (~14 chars). Uniqueness
// comes from the DB UNIQUE constraint + atomic counter, never from this
// format — the format is only display.
export function invoiceNumberFor(financialYear: string, n: number): string {
  const short = financialYear.length === 7 ? financialYear.slice(2) : financialYear;
  return `STY/${short}/${String(n).padStart(4, "0")}`;
}

// GST 18% on top of the ex-GST plan price, rounded ONCE (integer paise,
// never floats). Same-state → CGST 9% + SGST 9% (halved with the odd paisa
// going to CGST so the split always sums exactly); otherwise IGST 18%.
export function computeGst(amountPaise: number, sameState: boolean): { cgst: number; sgst: number; igst: number } {
  const total = Math.round((amountPaise * GST_PERCENT) / 100);
  if (sameState) {
    const cgst = Math.round(total / 2);
    return { cgst, sgst: total - cgst, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: total };
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

// Day-floor in UTC. Period boundaries are ALWAYS day-floored: DATE columns
// truncate times, so an un-floored boundary would miss its own idempotency
// lookup on re-run and double-issue. This bit the first draft — hence the
// helper and the test that re-runs issuance twice.
export function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ---------------------------------------------------------------------------
// Request-time access (§13.4): the gate checks DATES, not just the stored
// status — a missed cycle run delays emails, never leaves access open.
// Demo schools bypass billing entirely (§13.11); everyone else:
// SUSPENDED → blocked · TRIAL past trialEndsAt → blocked · ACTIVE past
// periodEnd+grace → blocked (stale mirror) · PAST_DUE → allowed (grace).
// ---------------------------------------------------------------------------

export interface AccessSchool {
  isDemo: boolean;
  subscriptionStatus: string;
  trialEndsAt: Date;
}

export interface AccessSubscription {
  status: string;
  currentPeriodEnd: Date | null;
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; code: "SCHOOL_SUSPENDED" | "TRIAL_EXPIRED" | "SUBSCRIPTION_EXPIRED" };

export function schoolAccess(
  school: AccessSchool,
  subscription: AccessSubscription | null,
  now: Date = new Date(),
): AccessDecision {
  if (school.isDemo) {
    return { allowed: true };
  }
  if (school.subscriptionStatus === "SUSPENDED" || subscription?.status === "SUSPENDED") {
    return { allowed: false, code: "SCHOOL_SUSPENDED" };
  }
  if (school.subscriptionStatus === "TRIAL" && school.trialEndsAt.getTime() < now.getTime()) {
    return { allowed: false, code: "TRIAL_EXPIRED" };
  }
  const periodEnd = subscription?.currentPeriodEnd;
  if (
    (school.subscriptionStatus === "ACTIVE" || subscription?.status === "ACTIVE") &&
    periodEnd &&
    addDays(periodEnd, GRACE_DAYS).getTime() < now.getTime()
  ) {
    return { allowed: false, code: "SUBSCRIPTION_EXPIRED" };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Writes — single-writer rule (§16.1): ONLY this module writes
// schools.subscriptionStatus / schools.plan, mirroring the subscriptions
// row in the SAME transaction. Every transition is audited.
// ---------------------------------------------------------------------------

export interface SetSubscriptionInput {
  plan: SchoolPlan;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED";
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
}

// Owner-driven create-or-replace (plan purchase, plan change, suspension,
// reactivation, trial extension is a status+date variant of the same write).
export async function setSubscription(
  db: PrismaClient,
  schoolId: string,
  input: SetSubscriptionInput,
  // NULL = the billing-cycle job (a machine actor — same honesty as the
  // webhook's NULL actor, §13.10). Human callers pass their user id.
  actorId: string | null,
  action: "SUBSCRIPTION_CREATED" | "SUBSCRIPTION_PLAN_CHANGE" | "SUBSCRIPTION_STATUS_CHANGE",
): Promise<{ id: string; plan: SchoolPlan; status: string }> {
  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    throw new AuthError(404, "SCHOOL_NOT_FOUND", "School not found.");
  }
  const before = await db.subscription.findUnique({ where: { schoolId } });
  const result = await db.$transaction(async (tx) => {
    const row = await tx.subscription.upsert({
      where: { schoolId },
      update: {
        plan: input.plan,
        status: input.status,
        currentPeriodStart: input.currentPeriodStart ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
      },
      create: {
        schoolId,
        plan: input.plan,
        status: input.status,
        currentPeriodStart: input.currentPeriodStart ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
      },
    });
    await tx.school.update({
      where: { id: schoolId },
      data: { plan: input.plan, subscriptionStatus: input.status },
    });
    const txClient = tx as unknown as PrismaClient;
    await recordAudit(txClient, {
      schoolId,
      actorId,
      action,
      entity: "Subscription",
      entityId: row.id,
      ...(before
        ? { before: pickAuditFields("Subscription", { id: before.id, plan: before.plan, status: before.status }) }
        : {}),
      after: pickAuditFields("Subscription", { id: row.id, plan: row.plan, status: row.status }),
    });
    return row;
  });
  return { id: result.id, plan: result.plan as SchoolPlan, status: result.status };
}

export interface IssueInvoiceInput {
  plan: SchoolPlan;
  periodStart: Date;
  periodEnd: Date;
  // School's State (registration, §8.3) vs the platform's registered State
  // (PLATFORM_STATE env): match → CGST+SGST, else IGST.
  schoolState: string | null;
  platformState: string | null;
}

// One invoice per school per period (§16.1): the number comes from an atomic
// per-financial-year counter bumped in the SAME transaction (never
// count()+1). Idempotent on (school, periodStart): re-issuing returns the
// existing row instead of double-billing.
export async function issueInvoice(
  db: PrismaClient,
  schoolId: string,
  input: IssueInvoiceInput,
  actorId: string | null,
): Promise<{ id: string; invoiceNumber: string; amountPaise: number; status: string }> {
  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) {
    throw new AuthError(404, "SCHOOL_NOT_FOUND", "School not found.");
  }
  const existing = await db.subscriptionInvoice.findFirst({
    where: { schoolId, periodStart: input.periodStart },
  });
  if (existing) {
    return {
      id: existing.id,
      invoiceNumber: existing.invoiceNumber,
      amountPaise: existing.amountPaise,
      status: existing.status,
    };
  }
  const amountPaise = PLANS[input.plan].pricePaise;
  const sameState =
    !!input.schoolState && !!input.platformState && input.schoolState.trim().toLowerCase() === input.platformState.trim().toLowerCase();
  const gst = computeGst(amountPaise, sameState);
  const fy = financialYear(input.periodStart);
  const created = await db.$transaction(async (tx) => {
    // Atomic bump: upsert-then-read inside the transaction serializes
    // concurrent issuers on the row write (InnoDB), so two invoices created
    // at once never share a number. The UNIQUE constraint is the backstop:
    // a P2002 here means a lost race — re-read instead of duplicating.
    await tx.billingCounter.upsert({
      where: { financialYear: fy },
      update: { lastNumber: { increment: 1 } },
      create: { financialYear: fy, lastNumber: 1 },
    });
    const counter = await tx.billingCounter.findUniqueOrThrow({ where: { financialYear: fy } });
    const invoiceNumber = invoiceNumberFor(fy, counter.lastNumber);
    const row = await tx.subscriptionInvoice.create({
      data: {
        schoolId,
        invoiceNumber,
        financialYear: fy,
        amountPaise,
        cgstPaise: gst.cgst,
        sgstPaise: gst.sgst,
        igstPaise: gst.igst,
        status: "PENDING",
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
    });
    const txClient = tx as unknown as PrismaClient;
    await recordAudit(txClient, {
      schoolId,
      actorId,
      action: "SUBSCRIPTION_INVOICE_ISSUED",
      entity: "SubscriptionInvoice",
      entityId: row.id,
      after: pickAuditFields("SubscriptionInvoice", {
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        status: row.status,
        amountPaise: row.amountPaise,
        cgstPaise: row.cgstPaise,
        sgstPaise: row.sgstPaise,
        igstPaise: row.igstPaise,
        paidMethod: null,
      }),
    });
    return row;
  }).catch(async (err: unknown) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.subscriptionInvoice.findFirst({ where: { schoolId, periodStart: input.periodStart } });
      if (raced) {
        return raced;
      }
    }
    throw err;
  });
  return { id: created.id, invoiceNumber: created.invoiceNumber, amountPaise: created.amountPaise, status: created.status };
}

// Owner marks an invoice paid (baseline §16.1 — audited, method MANUAL).
// Flips the invoice, re-activates the subscription for the invoice's
// period, and mirrors both onto schools.* in ONE transaction. Reversible
// flow states only: PENDING pays; PAID is a no-op return (idempotent).
export async function markInvoicePaid(
  db: PrismaClient,
  invoiceId: string,
  actorId: string,
): Promise<{ id: string; status: string }> {
  const invoice = await db.subscriptionInvoice.findFirst({ where: { id: invoiceId } });
  if (!invoice) {
    throw new AuthError(404, "INVOICE_NOT_FOUND", "Subscription invoice not found.");
  }
  if (invoice.status === "PAID") {
    return { id: invoice.id, status: invoice.status };
  }
  const subscription = await db.subscription.findUnique({ where: { schoolId: invoice.schoolId } });
  const updated = await db.$transaction(async (tx) => {
    const paid = await tx.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { status: "PAID", paidAt: new Date(), paidMethod: "MANUAL" },
    });
    const txClient = tx as unknown as PrismaClient;
    await recordAudit(txClient, {
      schoolId: invoice.schoolId,
      actorId,
      action: "SUBSCRIPTION_INVOICE_PAID",
      entity: "SubscriptionInvoice",
      entityId: invoice.id,
      before: pickAuditFields("SubscriptionInvoice", {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        amountPaise: invoice.amountPaise,
        cgstPaise: invoice.cgstPaise,
        sgstPaise: invoice.sgstPaise,
        igstPaise: invoice.igstPaise,
        paidMethod: invoice.paidMethod,
      }),
      after: pickAuditFields("SubscriptionInvoice", {
        id: paid.id,
        invoiceNumber: paid.invoiceNumber,
        status: paid.status,
        amountPaise: paid.amountPaise,
        cgstPaise: paid.cgstPaise,
        sgstPaise: paid.sgstPaise,
        igstPaise: paid.igstPaise,
        paidMethod: paid.paidMethod,
      }),
    });
    if (subscription) {
      const sub = await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: "ACTIVE", currentPeriodStart: invoice.periodStart, currentPeriodEnd: invoice.periodEnd },
      });
      await tx.school.update({
        where: { id: invoice.schoolId },
        data: { subscriptionStatus: "ACTIVE" },
      });
      await recordAudit(txClient, {
        schoolId: invoice.schoolId,
        actorId,
        action: "SUBSCRIPTION_STATUS_CHANGE",
        entity: "Subscription",
        entityId: sub.id,
        before: pickAuditFields("Subscription", { id: subscription.id, plan: subscription.plan, status: subscription.status }),
        after: pickAuditFields("Subscription", { id: sub.id, plan: sub.plan, status: sub.status }),
      });
    }
    return paid;
  });
  return { id: updated.id, status: updated.status };
}

export interface BillingCycleResult {
  at: string;
  schoolsChecked: number;
  transitioned: { schoolId: string; from: string; to: string }[];
  invoicesIssued: number;
}

// Nightly/hourly billing cycle (§12.4 job list: subscription
// expiry/dunning). Per non-demo school, with day-floored boundaries:
// - TRIAL lapsed → PAST_DUE + first 30-day invoice. The row's dates are
//   DEADLINE-form (start = lapse day, end = lapse day): suspend fires 7
//   days later, and markInvoicePaid overwrites them with the invoice's
//   real period on payment. Documented because it looks odd on purpose.
// - PAST_DUE with now > end+7d → SUSPENDED (data retained, §16).
// - ACTIVE with a real end now past → PAST_DUE + next-period invoice
//   (fires AT expiry, so the school sees PAST_DUE+paper before any block).
// - ACTIVE with no dates (pre-billing legacy rows) → PAST_DUE + invoice
//   for [today, +30d); unknown paid state honestly means "needs to pay".
// Idempotent: transitions fire only from the exact expected prior state,
// and issueInvoice() is period-keyed — a re-run changes nothing. NULL
// actor throughout: the cycle is a machine, like the webhook.
export async function runBillingCycle(
  db: PrismaClient,
  now: Date = new Date(),
  // Code-level targeting only (tests, ops one-offs) — the HTTP route never
  // exposes it. Lets a test sweep exactly its own fixtures instead of every
  // accumulated row in a shared database (same lesson as runFeeRemindersJob).
  opts?: { schoolIds?: string[] },
): Promise<BillingCycleResult> {
  const result: BillingCycleResult = { at: now.toISOString(), schoolsChecked: 0, transitioned: [], invoicesIssued: 0 };
  const today = startOfDayUtc(now);
  const schools = await db.school.findMany({
    where: { isDemo: false, ...(opts?.schoolIds ? { id: { in: opts.schoolIds } } : {}) },
    select: { id: true, subscriptionStatus: true, trialEndsAt: true, plan: true, state: true },
  });
  const platformState = process.env.PLATFORM_STATE ?? null;
  const pastGrace = (end: Date): boolean => addDays(end, GRACE_DAYS).getTime() < now.getTime();
  for (const school of schools) {
    result.schoolsChecked += 1;
    const sub = await db.subscription.findUnique({ where: { schoolId: school.id } });
    // Trial lapsed → PAST_DUE + first invoice (Standard tier by default).
    if (school.subscriptionStatus === "TRIAL" && school.trialEndsAt.getTime() < now.getTime()) {
      const plan = school.plan ?? "STANDARD";
      await issueInvoice(
        db,
        school.id,
        { plan, periodStart: today, periodEnd: addDays(today, 30), schoolState: school.state, platformState },
        null,
      );
      result.invoicesIssued += 1;
      await setSubscription(
        db,
        school.id,
        { plan, status: "PAST_DUE", currentPeriodStart: today, currentPeriodEnd: today },
        null,
        "SUBSCRIPTION_STATUS_CHANGE",
      );
      result.transitioned.push({ schoolId: school.id, from: "TRIAL", to: "PAST_DUE" });
      continue;
    }
    // PAST_DUE past grace → SUSPENDED (data retained, §16 auto-downgrade).
    const anchor = sub?.currentPeriodEnd ?? null;
    if (school.subscriptionStatus === "PAST_DUE" && anchor && pastGrace(anchor)) {
      await setSubscription(
        db,
        school.id,
        { plan: sub?.plan ?? school.plan ?? "BASIC", status: "SUSPENDED", currentPeriodStart: null, currentPeriodEnd: null },
        null,
        "SUBSCRIPTION_STATUS_CHANGE",
      );
      result.transitioned.push({ schoolId: school.id, from: "PAST_DUE", to: "SUSPENDED" });
      continue;
    }
    // ACTIVE with a real end now past → PAST_DUE + next-period invoice.
    if (school.subscriptionStatus === "ACTIVE" && anchor && anchor.getTime() < now.getTime()) {
      const plan = sub?.plan ?? school.plan ?? "BASIC";
      const periodStart = startOfDayUtc(addDays(anchor, 1));
      const periodEnd = startOfDayUtc(addDays(anchor, 31));
      await issueInvoice(
        db,
        school.id,
        { plan, periodStart, periodEnd, schoolState: school.state, platformState },
        null,
      );
      result.invoicesIssued += 1;
      await setSubscription(
        db,
        school.id,
        { plan, status: "PAST_DUE", currentPeriodStart: sub?.currentPeriodStart ?? null, currentPeriodEnd: anchor },
        null,
        "SUBSCRIPTION_STATUS_CHANGE",
      );
      result.transitioned.push({ schoolId: school.id, from: "ACTIVE", to: "PAST_DUE" });
      continue;
    }
    // ACTIVE with no dates (pre-billing legacy rows): unknown paid state
    // honestly means "needs to pay" — same first-invoice treatment as a
    // lapsed trial, including the deadline-form row dates.
    if (school.subscriptionStatus === "ACTIVE" && !anchor) {
      const plan = sub?.plan ?? school.plan ?? "BASIC";
      await issueInvoice(
        db,
        school.id,
        { plan, periodStart: today, periodEnd: addDays(today, 30), schoolState: school.state, platformState },
        null,
      );
      result.invoicesIssued += 1;
      await setSubscription(
        db,
        school.id,
        { plan, status: "PAST_DUE", currentPeriodStart: today, currentPeriodEnd: today },
        null,
        "SUBSCRIPTION_STATUS_CHANGE",
      );
      result.transitioned.push({ schoolId: school.id, from: "ACTIVE", to: "PAST_DUE" });
    }
  }
  return result;
}
