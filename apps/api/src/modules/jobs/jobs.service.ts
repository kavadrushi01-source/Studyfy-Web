import type { PrismaClient } from "@prisma/client";
import { seedDemo } from "@studyfy/demo-seed";
import { scopedPrismaClient } from "../../lib/prisma-tenant.js";
import { schoolHour } from "../../lib/school-time.js";
import { runFeeReminders } from "../fees/fees.service.js";
import {
  runBillingCycle,
  runBillingReminders,
  type BillingCycleResult,
  type BillingRemindersResult,
} from "../billing/billing.service.js";

// Fee reminders run at 9am in EACH school's own timezone (§12.4, §12.7):
// the external scheduler fires hourly; this job decides per school whether
// it is that school's hour. A delayed scheduler run that arrives at 10am
// local simply waits for tomorrow's 9am — never a catch-up blast.
const FEE_REMINDER_HOUR = 9;

export interface FeeRemindersJobResult {
  job: "fee-reminders";
  // ISO instant the job ran (UTC) — the per-school 9am decision is derived
  // from this, so a whole run is reproducible from one timestamp.
  at: string;
  schoolsChecked: number;
  schoolsProcessed: number;
  schoolsSkippedHour: number;
  schoolsSkippedSuspended: number;
  emailed: number;
  skipped: number;
}

// Idempotent by construction: runFeeReminders() stamps lastReminderAt per
// invoice per local day, so a repeated trigger (scheduler retry, manual
// re-fire) re-sends nothing — "job + school + period already done" skips.
// Demo schools are doubly excluded: the loop below never selects them AND
// runFeeReminders() itself suppresses demo mail (§13.11) — a "wipe and
// resend" bug pointed at a demo school degrades to a log line, never mail.
export async function runFeeRemindersJob(
  db: PrismaClient,
  now: Date = new Date(),
  // Code-level targeting only (tests, ops one-offs) — the HTTP route never
  // exposes it. Lets a test sweep exactly its own fixtures instead of every
  // accumulated row in a shared database.
  opts?: { schoolIds?: string[] },
): Promise<FeeRemindersJobResult> {
  const schools = await db.school.findMany({
    where: { isDemo: false, ...(opts?.schoolIds ? { id: { in: opts.schoolIds } } : {}) },
    select: { id: true, timezone: true, subscriptionStatus: true },
  });
  const result: FeeRemindersJobResult = {
    job: "fee-reminders",
    at: now.toISOString(),
    schoolsChecked: schools.length,
    schoolsProcessed: 0,
    schoolsSkippedHour: 0,
    schoolsSkippedSuspended: 0,
    emailed: 0,
    skipped: 0,
  };
  for (const school of schools) {
    if (school.subscriptionStatus === "SUSPENDED") {
      result.schoolsSkippedSuspended += 1;
      continue;
    }
    if (schoolHour(school.timezone, now) !== FEE_REMINDER_HOUR) {
      result.schoolsSkippedHour += 1;
      continue;
    }
    // Per-school scoped client (SECURITY_PATTERNS.md §5.2): each school's
    // work runs inside its own tenant boundary — never one raw-client
    // query across everyone. Fresh per school, never cached (§12.3).
    const scoped = scopedPrismaClient(db, school.id) as unknown as PrismaClient;
    const run = await runFeeReminders(scoped, school.id, now);
    result.schoolsProcessed += 1;
    result.emailed += run.emailed;
    result.skipped += run.skipped;
  }
  return result;
}

export interface BillingCycleJobResult {
  job: "billing-cycle";
  at: string;
  cycle: BillingCycleResult;
  reminders: BillingRemindersResult;
}

// Subscription billing (§12.4 job list, §16.1): transitions first
// (trial/period expiry → PAST_DUE → SUSPENDED), then the reminder half
// (trial-ending + overdue-invoice nudges). Both halves are idempotent
// (exact-prior-state transitions; audit-as-sent-log reminders), so an
// hourly trigger — or a manual re-fire — never double-bills, double
// suspends, or double-mails. Demo schools are excluded inside both loops.
export async function runBillingCycleJob(
  db: PrismaClient,
  now: Date = new Date(),
  // Code-level targeting only (tests) — the HTTP route never exposes it.
  opts?: { schoolIds?: string[] },
): Promise<BillingCycleJobResult> {
  const cycle = await runBillingCycle(db, now, opts);
  const reminders = await runBillingReminders(db, now, opts);
  return { job: "billing-cycle", at: now.toISOString(), cycle, reminders };
}

// ---------------------------------------------------------------------------
// Nightly demo reset (§13.11): wipe-and-reseed the two portfolio demo
// schools so the public demo never accumulates visitor mess.
//
// The reset job can destroy a school, so it guards TWICE: it only ever
// acts on a school with isDemo = true AND a slug on the explicit allowlist
// below, and refuses otherwise. Refusal is fail-closed for the WHOLE run:
// one present-but-not-demo school aborts everything (no wipe, no reseed) —
// a human looks, the job does not guess. A missing slug is recreated by
// the reseed (that is the point of the reset).
//
// Wipe order is FK-safe (children before parents; RESTRICT everywhere — no
// FK disabling, ever). Reseed is one seedDemo() call after all wipes;
// tests inject a stub for it (the reseed path itself is proven by every
// db:seed + e2e run).
// ---------------------------------------------------------------------------

export const DEMO_RESET_SLUGS = ["school-of-science", "ramakrishna-school"] as const;

export interface DemoResetJobResult {
  job: "demo-reset";
  at: string;
  reset: string[];
  refused: { slug: string; reason: string }[];
  missing: string[];
  reseeded: boolean;
}

async function wipeSchoolScope(db: PrismaClient, schoolId: string): Promise<void> {
  const where = { schoolId };
  await db.$transaction([
    db.ticketAttachment.deleteMany({ where }),
    db.ticketMessage.deleteMany({ where }),
    db.ticket.deleteMany({ where }),
    db.message.deleteMany({ where }),
    db.notice.deleteMany({ where }),
    db.homeworkSubmission.deleteMany({ where }),
    db.homework.deleteMany({ where }),
    db.mark.deleteMany({ where }),
    db.examRemark.deleteMany({ where }),
    db.examSubject.deleteMany({ where }),
    db.exam.deleteMany({ where }),
    db.attendance.deleteMany({ where }),
    db.staffAttendance.deleteMany({ where }),
    db.leaveRequest.deleteMany({ where }),
    db.payroll.deleteMany({ where }),
    db.feePayment.deleteMany({ where }),
    db.feeInvoice.deleteMany({ where }),
    db.feeStructure.deleteMany({ where }),
    db.bookLoan.deleteMany({ where }),
    db.book.deleteMany({ where }),
    db.studentRoute.deleteMany({ where }),
    db.transportRoute.deleteMany({ where }),
    db.vehicle.deleteMany({ where }),
    db.studentGuardian.deleteMany({ where }),
    db.student.deleteMany({ where }),
    db.teacherSubject.deleteMany({ where }),
    db.timetableSlot.deleteMany({ where }),
    db.section.deleteMany({ where }),
    db.staff.deleteMany({ where }),
    db.subject.deleteMany({ where }),
    db.class.deleteMany({ where }),
    db.academicYear.deleteMany({ where }),
    db.certificate.deleteMany({ where }),
    db.document.deleteMany({ where }),
    db.inventoryMovement.deleteMany({ where }),
    db.inventoryItem.deleteMany({ where }),
    db.biometricDevice.deleteMany({ where }),
    db.enquiryNote.deleteMany({ where }),
    db.enquiry.deleteMany({ where }),
    db.subscriptionInvoice.deleteMany({ where }),
    db.subscription.deleteMany({ where }),
    db.auditLog.deleteMany({ where }),
  ]);
  const userIds = (await db.user.findMany({ where, select: { id: true } })).map((u) => u.id);
  await db.$transaction([
    db.authToken.deleteMany({ where: { userId: { in: userIds } } }),
    db.refreshToken.deleteMany({ where: { userId: { in: userIds } } }),
    db.user.deleteMany({ where }),
    db.school.delete({ where: { id: schoolId } }),
  ]);
}

export async function runDemoResetJob(
  db: PrismaClient,
  opts?: { reseed?: () => Promise<void> },
): Promise<DemoResetJobResult> {
  const result: DemoResetJobResult = {
    job: "demo-reset",
    at: new Date().toISOString(),
    reset: [],
    refused: [],
    missing: [],
    reseeded: false,
  };
  const schools = await db.school.findMany({
    where: { slug: { in: [...DEMO_RESET_SLUGS] } },
    select: { id: true, slug: true, isDemo: true },
  });
  for (const slug of DEMO_RESET_SLUGS) {
    if (!schools.some((s) => s.slug === slug)) {
      result.missing.push(slug);
    }
  }
  const squatters = schools.filter((s) => !s.isDemo);
  if (squatters.length > 0) {
    for (const s of squatters) {
      result.refused.push({ slug: s.slug, reason: "not a demo school — wipe refused" });
    }
    console.error(`[demo-reset] REFUSED: ${squatters.map((s) => s.slug).join(", ")} — nothing wiped, nothing reseeded.`);
    return result;
  }
  for (const school of schools) {
    await wipeSchoolScope(db, school.id);
    result.reset.push(school.slug);
  }
  if (schools.length > 0 || result.missing.length > 0) {
    // Default reseed is the compiled demo-seed package (same object the
    // db:seed script runs — tsx paths use its source, compiled consumers
    // use its dist; shared-types precedent). Tests inject a stub.
    await (opts?.reseed ?? (() => seedDemo(db)))();
    result.reseeded = true;
  }
  return result;
}
