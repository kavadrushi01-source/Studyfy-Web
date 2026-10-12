import type { PrismaClient } from "@prisma/client";
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
