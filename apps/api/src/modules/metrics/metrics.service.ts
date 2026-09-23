import { Prisma, type PrismaClient } from "@prisma/client";
import { LruCache } from "../../lib/lru.js";
import { schoolDay, schoolDayBoundsUtc, schoolMonth, schoolMonthBoundsUtc } from "../../lib/school-time.js";
import { AuthError } from "../auth/auth.service.js";

export interface DashboardKpis {
  totalStudents: number;
  // Weighted present / marked * 100 (LATE counts half, same weights as the
  // attendance summary). null when nothing is marked today — "no data" is
  // honest, 0% would be a lie on a Sunday morning.
  todayAttendancePercent: number | null;
  // This month's collected payments, Decimal-exact string (§13.6).
  monthFeeCollection: string;
  asOf: { day: string; month: string };
}

// One process-wide cache (§12.3 — in-memory, no Redis until a bottleneck
// proves otherwise). 600 entries = 200 schools × 3 KPIs with headroom;
// 60s TTL bounds staleness for the dashboard use case (writes also
// invalidate eagerly, so TTL is the backstop, not the mechanism).
// Key rule from the spec: every key includes school_id — no exceptions,
// so a key can never serve one school's aggregate to another.
const kpis = new LruCache<DashboardKpis | number | string | null>({
  maxEntries: 600,
  ttlMs: 60_000,
});

function studentsKey(schoolId: string): string {
  return `kpi:students:${schoolId}`;
}

function attendanceKey(schoolId: string, day: string): string {
  return `kpi:attendance:${schoolId}:${day}`;
}

function feesKey(schoolId: string, year: number, month: number): string {
  return `kpi:fees:${schoolId}:${year}-${String(month).padStart(2, "0")}`;
}

export async function getTotalStudents(db: PrismaClient, schoolId: string): Promise<number> {
  const key = studentsKey(schoolId);
  const cached = kpis.get(key);
  if (typeof cached === "number") {
    return cached;
  }
  const total = await db.student.count({ where: { schoolId } });
  kpis.set(key, total);
  return total;
}

function attendanceWeight(status: string): number {
  if (status === "PRESENT") {
    return 1;
  }
  if (status === "LATE") {
    return 0.5;
  }
  return 0;
}

export async function getTodayAttendancePercent(
  db: PrismaClient,
  schoolId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<number | null> {
  const day = schoolDay(timezone, now);
  const key = attendanceKey(schoolId, day);
  const cached = kpis.get(key);
  if (typeof cached === "number" || cached === null) {
    return cached;
  }
  const { start, end } = schoolDayBoundsUtc(timezone, day);
  const rows = await db.attendance.findMany({
    where: { schoolId, date: { gte: start, lt: end } },
    select: { status: true },
  });
  if (rows.length === 0) {
    kpis.set(key, null);
    return null;
  }
  const present = rows.reduce((sum, row) => sum + attendanceWeight(row.status), 0);
  const percent = Math.round((present / rows.length) * 1000) / 10;
  kpis.set(key, percent);
  return percent;
}

export async function getMonthFeeCollection(
  db: PrismaClient,
  schoolId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<string> {
  const { year, month } = schoolMonth(timezone, now);
  const key = feesKey(schoolId, year, month);
  const cached = kpis.get(key);
  if (typeof cached === "string") {
    return cached;
  }
  const { start, end } = schoolMonthBoundsUtc(timezone, year, month);
  const total = await db.feePayment.aggregate({
    _sum: { amount: true },
    where: { schoolId, paidAt: { gte: start, lt: end } },
  });
  // Decimal crosses as string; toFixed(2) keeps the §13.6 exactness at the
  // boundary instead of leaking float dust into the dashboard.
  const collected = new Prisma.Decimal(total._sum.amount ?? 0).toFixed(2);
  kpis.set(key, collected);
  return collected;
}

export async function getDashboardKpis(
  db: PrismaClient,
  schoolId: string,
  now: Date = new Date(),
): Promise<DashboardKpis> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
  if (!school) {
    throw new AuthError(404, "SCHOOL_NOT_FOUND", "School not found.");
  }
  const [totalStudents, todayAttendancePercent, monthFeeCollection] = await Promise.all([
    getTotalStudents(db, schoolId),
    getTodayAttendancePercent(db, schoolId, school.timezone, now),
    getMonthFeeCollection(db, schoolId, school.timezone, now),
  ]);
  const day = schoolDay(school.timezone, now);
  const { year, month } = schoolMonth(school.timezone, now);
  return {
    totalStudents,
    todayAttendancePercent,
    monthFeeCollection,
    asOf: { day, month: `${year}-${String(month).padStart(2, "0")}` },
  };
}

// Eager invalidation (§12.3 "invalidate on write") — called by the write
// paths, not by a timer. Each invalidator is scoped to its own KPI so a
// fee payment never evicts the roster count it didn't change.
export function invalidateStudentKpis(schoolId: string): void {
  kpis.deletePrefix(`kpi:students:${schoolId}`);
}

export function invalidateAttendanceKpis(schoolId: string): void {
  kpis.deletePrefix(`kpi:attendance:${schoolId}:`);
}

export function invalidateFeeKpis(schoolId: string): void {
  kpis.deletePrefix(`kpi:fees:${schoolId}:`);
}

// Test seam: drop everything (each test file shares this process).
export function clearKpiCache(): void {
  kpis.clear();
}
