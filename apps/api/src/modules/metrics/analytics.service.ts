import { Prisma, type PrismaClient } from "@prisma/client";
import { gradeLetter, percentOf } from "../../lib/grades.js";
import { LruCache } from "../../lib/lru.js";
import { schoolDay, schoolMonth, schoolMonthBoundsUtc } from "../../lib/school-time.js";
import { AuthError } from "../auth/auth.service.js";

// Admin analytics (§7 Phase 3 #19): school-wide trends the Phase-1 admin
// bundle deliberately does NOT carry (that bundle is KPIs + growth + feed;
// the accountant board owns the donut + transactions). Everything here is
// read-only aggregation over tenant-scoped rows — no new tables, no new
// permission key (dashboard.read + SCHOOL_ADMIN, same as the admin bundle).
//
// Cache discipline mirrors metrics.service.ts (§12.3): own LRU, keys carry
// school_id, 60s TTL as backstop, eager invalidation on write via
// invalidateAnalytics() wired into marking/payment/marks-entry.

export interface AttendanceTrendPoint {
  date: string;
  percent: number | null;
  marked: number;
}

export interface FeeTrendPoint {
  month: string;
  collected: string;
}

export interface GradeBucket {
  grade: string;
  count: number;
}

export interface ExamPerformance {
  examId: string;
  examName: string;
  takers: number;
  averagePercent: number | null;
  topPercent: number | null;
  distribution: GradeBucket[];
}

export interface SectionAnalyticsRow {
  sectionId: string;
  className: string;
  sectionName: string;
  pupils: number;
  attendancePercent: number | null;
}

export interface AnalyticsOverview {
  attendanceTrend: AttendanceTrendPoint[];
  feeTrend: FeeTrendPoint[];
  pendingFees: string;
  overdueFees: string;
  exams: ExamPerformance[];
  sections: SectionAnalyticsRow[];
  asOf: { day: string; month: string };
}

const GRADE_ORDER = ["A+", "A", "B+", "B", "C+", "C", "D", "F"];

const analyticsCache = new LruCache<AnalyticsOverview>({ maxEntries: 200, ttlMs: 60_000 });

function overviewKey(schoolId: string, day: string): string {
  return `analytics:overview:${schoolId}:${day}`;
}

export function invalidateAnalytics(schoolId: string): void {
  analyticsCache.deletePrefix(`analytics:overview:${schoolId}:`);
}

// Test seam: drop everything (each test file shares this process).
export function clearAnalyticsCache(): void {
  analyticsCache.clear();
}

// Same weights as attendance.service.ts / the KPI math: PRESENT = 1,
// LATE = 0.5, anything else = 0.
function attendanceWeight(status: string): number {
  if (status === "PRESENT") {
    return 1;
  }
  if (status === "LATE") {
    return 0.5;
  }
  return 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function getAnalyticsOverview(
  db: PrismaClient,
  schoolId: string,
  now: Date = new Date(),
): Promise<AnalyticsOverview> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
  if (!school) {
    throw new AuthError(404, "SCHOOL_NOT_FOUND", "School not found.");
  }
  const day = schoolDay(school.timezone, now);
  const key = overviewKey(schoolId, day);
  const cached = analyticsCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const { year, month } = schoolMonth(school.timezone, now);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  // Trailing 30 school-local days. One query, grouped in JS — the marked
  // calendar day stored on the row IS the school day by construction
  // (marking writes the section's day, never server UTC), so grouping by
  // the stored day needs no conversion.
  const [y, m, d] = day.split("-").map(Number);
  const days: string[] = [];
  for (let back = 29; back >= 0; back -= 1) {
    const t = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, (d ?? 1) - back));
    days.push(t.toISOString().slice(0, 10));
  }
  const trendStart = new Date(`${days[0] ?? day}T00:00:00Z`);
  const attendanceRows = await db.attendance.findMany({
    where: { schoolId, date: { gte: trendStart } },
    select: { date: true, status: true },
  });
  const byDay = new Map<string, { weighted: number; marked: number }>();
  for (const row of attendanceRows) {
    const k = row.date.toISOString().slice(0, 10);
    const entry = byDay.get(k) ?? { weighted: 0, marked: 0 };
    entry.weighted += attendanceWeight(row.status);
    entry.marked += 1;
    byDay.set(k, entry);
  }
  const attendanceTrend: AttendanceTrendPoint[] = days.map((date) => {
    const entry = byDay.get(date);
    if (!entry || entry.marked === 0) {
      return { date, percent: null, marked: 0 };
    }
    return { date, percent: round1((entry.weighted / entry.marked) * 100), marked: entry.marked };
  });

  // Fee trend: trailing 6 school months collected (paidAt instants bucketed
  // into school-local months) + right-now pending/overdue (same outstanding
  // math as the accountant board: amount − amountPaid).
  const feeMonths: { year: number; month: number }[] = [];
  for (let back = 5; back >= 0; back -= 1) {
    const t = new Date(Date.UTC(year, month - 1 - back, 1));
    feeMonths.push({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 });
  }
  const feeWindowStart = schoolMonthBoundsUtc(
    school.timezone,
    feeMonths[0]?.year ?? year,
    feeMonths[0]?.month ?? month,
  ).start;
  const [windowPayments, invoices] = await Promise.all([
    db.feePayment.findMany({
      where: { schoolId, paidAt: { gte: feeWindowStart } },
      select: { amount: true, paidAt: true },
    }),
    db.feeInvoice.findMany({ where: { schoolId }, select: { status: true, amount: true, amountPaid: true } }),
  ]);
  const collectedByMonth = new Map<string, Prisma.Decimal>();
  for (const payment of windowPayments) {
    const sm = schoolMonth(school.timezone, payment.paidAt);
    const k = `${sm.year}-${String(sm.month).padStart(2, "0")}`;
    collectedByMonth.set(k, (collectedByMonth.get(k) ?? new Prisma.Decimal(0)).plus(new Prisma.Decimal(payment.amount)));
  }
  const feeTrend: FeeTrendPoint[] = feeMonths.map((fm) => {
    const k = `${fm.year}-${String(fm.month).padStart(2, "0")}`;
    return { month: k, collected: (collectedByMonth.get(k) ?? new Prisma.Decimal(0)).toFixed(2) };
  });
  let pending = new Prisma.Decimal(0);
  let overdue = new Prisma.Decimal(0);
  for (const invoice of invoices) {
    const outstanding = new Prisma.Decimal(invoice.amount).minus(new Prisma.Decimal(invoice.amountPaid));
    if (invoice.status === "PENDING" || invoice.status === "PARTIAL") {
      pending = pending.plus(outstanding);
    }
    if (invoice.status === "OVERDUE") {
      overdue = overdue.plus(outstanding);
    }
  }

  // Exam performance: latest 5 exams by creation. Per-student totals across
  // the exam's subjects → mean percent, top percent, full A+..F spread
  // (zero buckets included — an empty F row is information, not noise).
  const exams = await db.exam.findMany({
    where: { schoolId },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const examIds = exams.map((e) => e.id);
  const examSubjects = examIds.length > 0
    ? await db.examSubject.findMany({
      where: { examId: { in: examIds } },
      select: { id: true, examId: true, maxMarks: true },
    })
    : [];
  const subjectIds = examSubjects.map((s) => s.id);
  const marks = subjectIds.length > 0
    ? await db.mark.findMany({
      where: { examSubjectId: { in: subjectIds }, marksObtained: { not: null } },
      select: { studentId: true, examSubjectId: true, marksObtained: true },
    })
    : [];
  const maxByExam = new Map<string, number>();
  const subjectExam = new Map<string, string>();
  for (const s of examSubjects) {
    subjectExam.set(s.id, s.examId);
    maxByExam.set(s.examId, (maxByExam.get(s.examId) ?? 0) + Number(s.maxMarks));
  }
  const totalsByExam = new Map<string, Map<string, number>>();
  for (const mark of marks) {
    const examId = subjectExam.get(mark.examSubjectId);
    if (!examId) {
      continue;
    }
    const totals = totalsByExam.get(examId) ?? new Map<string, number>();
    totals.set(mark.studentId, (totals.get(mark.studentId) ?? 0) + Number(mark.marksObtained ?? 0));
    totalsByExam.set(examId, totals);
  }
  const examPerformance: ExamPerformance[] = exams.map((exam) => {
    const max = maxByExam.get(exam.id) ?? 0;
    const totals = totalsByExam.get(exam.id) ?? new Map<string, number>();
    const percents = [...totals.values()].map((total) => percentOf(total, max));
    const counts = new Map<string, number>(GRADE_ORDER.map((g) => [g, 0]));
    for (const p of percents) {
      counts.set(gradeLetter(p), (counts.get(gradeLetter(p)) ?? 0) + 1);
    }
    return {
      examId: exam.id,
      examName: exam.name,
      takers: totals.size,
      averagePercent: percents.length > 0 ? round1(percents.reduce((a, b) => a + b, 0) / percents.length) : null,
      topPercent: percents.length > 0 ? Math.max(...percents) : null,
      distribution: GRADE_ORDER.map((grade) => ({ grade, count: counts.get(grade) ?? 0 })),
    };
  });

  // Section table: pupils per section + current school-month attendance %.
  const monthBounds = schoolMonthBoundsUtc(school.timezone, year, month);
  const [sections, monthRows] = await Promise.all([
    db.section.findMany({
      where: { schoolId },
      select: {
        id: true,
        name: true,
        class: { select: { name: true } },
        _count: { select: { students: true } },
      },
      orderBy: [{ class: { name: "asc" } }, { name: "asc" }],
    }),
    db.attendance.findMany({
      where: { schoolId, date: { gte: monthBounds.start, lt: monthBounds.end } },
      select: { sectionId: true, status: true },
    }),
  ]);
  const monthBySection = new Map<string, { weighted: number; marked: number }>();
  for (const row of monthRows) {
    const entry = monthBySection.get(row.sectionId) ?? { weighted: 0, marked: 0 };
    entry.weighted += attendanceWeight(row.status);
    entry.marked += 1;
    monthBySection.set(row.sectionId, entry);
  }
  const sectionRows: SectionAnalyticsRow[] = sections.map((s) => {
    const entry = monthBySection.get(s.id);
    return {
      sectionId: s.id,
      className: s.class.name,
      sectionName: s.name,
      pupils: s._count.students,
      attendancePercent: entry && entry.marked > 0 ? round1((entry.weighted / entry.marked) * 100) : null,
    };
  });

  const overview: AnalyticsOverview = {
    attendanceTrend,
    feeTrend,
    pendingFees: pending.toFixed(2),
    overdueFees: overdue.toFixed(2),
    exams: examPerformance,
    sections: sectionRows,
    asOf: { day, month: monthKey },
  };
  analyticsCache.set(key, overview);
  return overview;
}
