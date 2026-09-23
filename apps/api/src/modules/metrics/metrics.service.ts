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
const kpis = new LruCache<number | string | null | GrowthPoint[] | ActivityItem[]>({
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

// "Teachers" = staff holding the TEACHER role (office staff without a
// teaching role are not teachers, even if they appear in the staff table).
export async function getTotalTeachers(db: PrismaClient, schoolId: string): Promise<number> {
  const key = `kpi:teachers:${schoolId}`;
  const cached = kpis.get(key);
  if (typeof cached === "number") {
    return cached;
  }
  const total = await db.staff.count({ where: { schoolId, user: { role: { name: "TEACHER" } } } });
  kpis.set(key, total);
  return total;
}

export async function getTotalClasses(db: PrismaClient, schoolId: string): Promise<number> {
  const key = `kpi:classes:${schoolId}`;
  const cached = kpis.get(key);
  if (typeof cached === "number") {
    return cached;
  }
  const total = await db.class.count({ where: { schoolId } });
  kpis.set(key, total);
  return total;
}

export interface GrowthPoint {
  month: string;
  count: number;
}

// Admissions per school-local calendar month, trailing 6 months including
// the current one. Cumulative would hide this term's intake; per-month
// bars/points show it. Admissions change it → same invalidator as the
// student count.
export async function getStudentGrowth(
  db: PrismaClient,
  schoolId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<GrowthPoint[]> {
  const { year, month } = schoolMonth(timezone, now);
  const currentKey = `${year}-${String(month).padStart(2, "0")}`;
  const key = `kpi:growth:${schoolId}:${currentKey}`;
  const cached = kpis.get(key);
  if (Array.isArray(cached)) {
    return cached as GrowthPoint[];
  }
  const months: { year: number; month: number }[] = [];
  for (let back = 5; back >= 0; back -= 1) {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  const first = schoolMonthBoundsUtc(timezone, months[0]!.year, months[0]!.month).start;
  const rows = await db.student.findMany({
    where: { schoolId, createdAt: { gte: first } },
    select: { createdAt: true },
  });
  const counts = new Map<string, number>();
  for (const row of rows) {
    // createdAt is UTC; attribute to the school-local month it landed in.
    const m = schoolMonth(timezone, row.createdAt);
    const k = `${m.year}-${String(m.month).padStart(2, "0")}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const growth = months.map((m) => {
    const k = `${m.year}-${String(m.month).padStart(2, "0")}`;
    return { month: k, count: counts.get(k) ?? 0 };
  });
  kpis.set(key, growth);
  return growth;
}

export interface ActivityItem {
  kind: "notice" | "homework" | "exam" | "payment";
  title: string;
  at: string;
}

// Recent-activities feed: the newest items across the four things that
// actually happen in a school day, merged by timestamp. Read-only rollup —
// no new table, no event log to keep in sync; staleness bounded by TTL plus
// eager invalidation from all four write paths.
export async function getRecentActivities(db: PrismaClient, schoolId: string): Promise<ActivityItem[]> {
  const key = `kpi:activities:${schoolId}`;
  const cached = kpis.get(key);
  if (Array.isArray(cached)) {
    return cached as ActivityItem[];
  }
  const [notices, homework, exams, payments] = await Promise.all([
    db.notice.findMany({ where: { schoolId }, select: { title: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.homework.findMany({ where: { schoolId }, select: { title: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.exam.findMany({ where: { schoolId }, select: { name: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.feePayment.findMany({
      where: { schoolId },
      select: { amount: true, paidAt: true, invoice: { select: { student: { select: { user: { select: { name: true } } } } } } },
      orderBy: { paidAt: "desc" },
      take: 3,
    }),
  ]);
  const items: ActivityItem[] = [
    ...notices.map((n) => ({ kind: "notice" as const, title: n.title, at: n.createdAt.toISOString() })),
    ...homework.map((h) => ({ kind: "homework" as const, title: h.title, at: h.createdAt.toISOString() })),
    ...exams.map((e) => ({ kind: "exam" as const, title: e.name, at: e.createdAt.toISOString() })),
    ...payments.map((p) => ({
      kind: "payment" as const,
      title: `Fee received — ${p.invoice.student.user.name} (₹${new Prisma.Decimal(p.amount).toFixed(2)})`,
      at: p.paidAt.toISOString(),
    })),
  ];
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  const feed = items.slice(0, 8);
  kpis.set(key, feed);
  return feed;
}

export interface AdminDashboard {
  totalStudents: number;
  totalTeachers: number;
  totalClasses: number;
  feeCollection: string;
  growth: GrowthPoint[];
  activities: ActivityItem[];
  asOf: { day: string; month: string };
}

export async function getAdminDashboard(
  db: PrismaClient,
  schoolId: string,
  now: Date = new Date(),
): Promise<AdminDashboard> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
  if (!school) {
    throw new AuthError(404, "SCHOOL_NOT_FOUND", "School not found.");
  }
  const [totalStudents, totalTeachers, totalClasses, monthFeeCollection, growth, activities] = await Promise.all([
    getTotalStudents(db, schoolId),
    getTotalTeachers(db, schoolId),
    getTotalClasses(db, schoolId),
    getMonthFeeCollection(db, schoolId, school.timezone, now),
    getStudentGrowth(db, schoolId, school.timezone, now),
    getRecentActivities(db, schoolId),
  ]);
  const day = schoolDay(school.timezone, now);
  const { year, month } = schoolMonth(school.timezone, now);
  return {
    totalStudents,
    totalTeachers,
    totalClasses,
    feeCollection: monthFeeCollection,
    growth,
    activities,
    asOf: { day, month: `${year}-${String(month).padStart(2, "0")}` },
  };
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
// fee payment never evicts the roster count it didn't change. Two
// deliberate non-wirings: teacher/class counts have no API write path yet
// (qualification endpoints don't create staff or class rows), so their 60s
// TTL is the mechanism until one exists; growth rides on admissions via
// the student invalidator.
export function invalidateStudentKpis(schoolId: string): void {
  kpis.deletePrefix(`kpi:students:${schoolId}`);
  kpis.deletePrefix(`kpi:growth:${schoolId}:`);
}

export function invalidateAttendanceKpis(schoolId: string): void {
  kpis.deletePrefix(`kpi:attendance:${schoolId}:`);
}

export function invalidateFeeKpis(schoolId: string): void {
  kpis.deletePrefix(`kpi:fees:${schoolId}:`);
}

export function invalidateActivityFeed(schoolId: string): void {
  kpis.deletePrefix(`kpi:activities:${schoolId}`);
}

// Test seam: drop everything (each test file shares this process).
export function clearKpiCache(): void {
  kpis.clear();
}
