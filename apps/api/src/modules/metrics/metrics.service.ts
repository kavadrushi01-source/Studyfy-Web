import { Prisma, type PrismaClient } from "@prisma/client";
import { LruCache } from "../../lib/lru.js";
import { schoolDay, schoolDayBoundsUtc, schoolMonth, schoolMonthBoundsUtc, schoolWeekday } from "../../lib/school-time.js";
import { AuthError } from "../auth/auth.service.js";
import { listThreads } from "../messages/messages.service.js";

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
const kpis = new LruCache<number | string | null | GrowthPoint[] | ActivityItem[] | TeacherDashboard | AccountantDashboard>({
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

// ---------------------------------------------------------------------------
// Teacher board (§7 Phase 1 #9, §8.3 "Today" view)
// ---------------------------------------------------------------------------

export interface TeacherClassInfo {
  id: string;
  name: string;
  className: string;
}

export interface TeacherAttendanceStatus {
  sectionId: string;
  sectionName: string;
  className: string;
  marked: boolean;
  present: number;
  total: number;
}

export interface TeacherTimetableSlot {
  period: number;
  subjectName: string;
  sectionName: string;
  className: string;
  startTime: string | null;
  endTime: string | null;
}

export interface UpcomingItem {
  id: string;
  title: string;
  date: string | null;
  sectionName: string | null;
}

export interface RecentMessageItem {
  user: { id: string; name: string };
  lastBody: string;
  unread: number;
}

export interface TeacherDashboard {
  myClasses: TeacherClassInfo[];
  todayAttendance: TeacherAttendanceStatus[];
  homeworkPending: number;
  unreadMessages: number;
  todayTimetable: TeacherTimetableSlot[];
  upcomingHomework: UpcomingItem[];
  upcomingExams: UpcomingItem[];
  recentMessages: RecentMessageItem[];
  asOf: { day: string };
}

function teacherBoardKey(schoolId: string, staffId: string, day: string): string {
  return `kpi:tboard:${schoolId}:${staffId}:${day}`;
}

// "Teaches" = class teacher of the section OR scheduled there by timetable,
// with at least one subject qualification — the same relationship
// definition as homework posting and messaging scope, one shared meaning.
async function teacherSections(db: PrismaClient, schoolId: string, staffId: string) {
  const [owned, scheduled] = await Promise.all([
    db.section.findMany({
      where: { schoolId, classTeacherId: staffId },
      select: { id: true, name: true, class: { select: { name: true } } },
    }),
    db.timetableSlot.findMany({
      where: { schoolId, teacherId: staffId },
      select: { section: { select: { id: true, name: true, class: { select: { name: true } } } } },
    }),
  ]);
  const byId = new Map<string, { id: string; name: string; class: { name: string } }>();
  for (const s of owned) {
    byId.set(s.id, s);
  }
  for (const slot of scheduled) {
    if (!byId.has(slot.section.id)) {
      byId.set(slot.section.id, slot.section);
    }
  }
  return [...byId.values()];
}

export async function getTeacherDashboard(
  db: PrismaClient,
  schoolId: string,
  teacherUserId: string,
  now: Date = new Date(),
): Promise<TeacherDashboard> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
  if (!school) {
    throw new AuthError(404, "SCHOOL_NOT_FOUND", "School not found.");
  }
  const staff = await db.staff.findFirst({ where: { schoolId, userId: teacherUserId } });
  if (!staff) {
    throw new AuthError(403, "NOT_A_TEACHER", "This account has no teacher profile in this school.");
  }
  const day = schoolDay(school.timezone, now);
  const key = teacherBoardKey(schoolId, staff.id, day);
  const cached = kpis.get(key);
  if (cached !== undefined && typeof cached === "object" && cached !== null && !Array.isArray(cached) && "myClasses" in cached) {
    return cached;
  }

  const sections = await teacherSections(db, schoolId, staff.id);
  const sectionIds = sections.map((s) => s.id);
  const { start, end } = schoolDayBoundsUtc(school.timezone, day);
  const weekday = schoolWeekday(school.timezone, now);

  const [marks, submissions, unread, slots, homework, exams, threads] = await Promise.all([
    sectionIds.length === 0
      ? []
      : db.attendance.findMany({
          where: { schoolId, sectionId: { in: sectionIds }, date: { gte: start, lt: end } },
          select: { sectionId: true, status: true },
        }),
    db.homeworkSubmission.count({
      where: { schoolId, status: "SUBMITTED", homework: { teacherId: staff.id } },
    }),
    db.message.count({ where: { schoolId, receiverId: teacherUserId, readAt: null } }),
    db.timetableSlot.findMany({
      where: { schoolId, teacherId: staff.id, dayOfWeek: weekday },
      select: {
        period: true,
        startTime: true,
        endTime: true,
        subject: { select: { name: true } },
        section: { select: { name: true, class: { select: { name: true } } } },
      },
      orderBy: { period: "asc" },
    }),
    sectionIds.length === 0
      ? []
      : db.homework.findMany({
          where: { schoolId, sectionId: { in: sectionIds }, dueDate: { gte: start } },
          select: { id: true, title: true, dueDate: true, section: { select: { name: true } } },
          orderBy: { dueDate: "asc" },
          take: 5,
        }),
    db.exam.findMany({
      where: { schoolId, OR: [{ startDate: { gte: start } }, { startDate: null }] },
      select: { id: true, name: true, startDate: true },
      orderBy: { startDate: "asc" },
      take: 5,
    }),
    listThreads(db, { userId: teacherUserId, role: "TEACHER" }),
  ]);

  const marksBySection = new Map<string, { present: number; total: number }>();
  for (const mark of marks) {
    const entry = marksBySection.get(mark.sectionId) ?? { present: 0, total: 0 };
    entry.total += 1;
    if (mark.status === "PRESENT" || mark.status === "LATE") {
      entry.present += 1;
    }
    marksBySection.set(mark.sectionId, entry);
  }

  const board: TeacherDashboard = {
    myClasses: sections.map((s) => ({ id: s.id, name: s.name, className: s.class.name })),
    todayAttendance: sections.map((s) => {
      const entry = marksBySection.get(s.id);
      return {
        sectionId: s.id,
        sectionName: s.name,
        className: s.class.name,
        marked: (entry?.total ?? 0) > 0,
        present: entry?.present ?? 0,
        total: entry?.total ?? 0,
      };
    }),
    homeworkPending: submissions,
    unreadMessages: unread,
    todayTimetable: slots.map((slot) => ({
      period: slot.period,
      subjectName: slot.subject.name,
      sectionName: slot.section.name,
      className: slot.section.class.name,
      startTime: slot.startTime,
      endTime: slot.endTime,
    })),
    upcomingHomework: homework.map((h) => ({
      id: h.id,
      title: h.title,
      date: h.dueDate.toISOString().slice(0, 10),
      sectionName: h.section.name,
    })),
    upcomingExams: exams.map((e) => ({
      id: e.id,
      title: e.name,
      date: e.startDate ? e.startDate.toISOString().slice(0, 10) : null,
      sectionName: null,
    })),
    recentMessages: threads.threads.slice(0, 3).map((t) => ({
      user: t.user,
      lastBody: t.lastMessage.body,
      unread: t.unread,
    })),
    asOf: { day },
  };
  kpis.set(key, board);
  return board;
}

// A teacher's own writes (marking, messaging, grading) plus the admin
// actions that reshape their board (assignments, timetable, notices,
// exams, payments-as-activity) all funnel through here: one prefix drop
// per school clears every staff/day variant without touching other
// schools' entries.
export function invalidateTeacherBoards(schoolId: string): void {
  kpis.deletePrefix(`kpi:tboard:${schoolId}:`);
}

// ---------------------------------------------------------------------------
// Accountant board (§7 Phase 1 #9, §8.3)
// ---------------------------------------------------------------------------

export interface TrendPoint {
  month: string;
  collected: string;
}

export interface StatusSlice {
  status: string;
  count: number;
  amount: string;
}

export interface TransactionItem {
  id: string;
  studentName: string;
  amount: string;
  method: string;
  paidAt: string;
  invoiceStatus: string;
}

export interface AccountantDashboard {
  totalCollected: string;
  pendingFees: string;
  overdueFees: string;
  totalStudents: number;
  trend: TrendPoint[];
  byStatus: StatusSlice[];
  recentTransactions: TransactionItem[];
  asOf: { day: string; month: string };
}

function accountantBoardKey(schoolId: string, year: number, month: number): string {
  return `kpi:aboard:${schoolId}:${year}-${String(month).padStart(2, "0")}`;
}

// Money sums stay Decimal-exact end to end (§13.6): aggregate in the DB,
// add up with Prisma.Decimal in JS (Prisma has no SUM(a-b)), serialize
// with toFixed(2) at the boundary.
export async function getAccountantDashboard(
  db: PrismaClient,
  schoolId: string,
  now: Date = new Date(),
): Promise<AccountantDashboard> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
  if (!school) {
    throw new AuthError(404, "SCHOOL_NOT_FOUND", "School not found.");
  }
  const { year, month } = schoolMonth(school.timezone, now);
  const key = accountantBoardKey(schoolId, year, month);
  const cached = kpis.get(key);
  if (cached !== undefined && typeof cached === "object" && cached !== null && !Array.isArray(cached) && "trend" in cached) {
    return cached;
  }

  const months: { year: number; month: number }[] = [];
  for (let back = 5; back >= 0; back -= 1) {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  const windowStart = schoolMonthBoundsUtc(school.timezone, months[0]!.year, months[0]!.month).start;

  const [totalStudents, collected, invoices, windowPayments, recent] = await Promise.all([
    getTotalStudents(db, schoolId),
    db.feePayment.aggregate({ _sum: { amount: true }, where: { schoolId } }),
    db.feeInvoice.findMany({
      where: { schoolId },
      select: { status: true, amount: true, amountPaid: true },
    }),
    db.feePayment.findMany({
      where: { schoolId, paidAt: { gte: windowStart } },
      select: { amount: true, paidAt: true },
    }),
    db.feePayment.findMany({
      where: { schoolId },
      select: {
        id: true,
        amount: true,
        method: true,
        paidAt: true,
        invoice: { select: { status: true, student: { select: { user: { select: { name: true } } } } } },
      },
      orderBy: { paidAt: "desc" },
      take: 8,
    }),
  ]);

  let pending = new Prisma.Decimal(0);
  let overdue = new Prisma.Decimal(0);
  const byStatus = new Map<string, { count: number; amount: Prisma.Decimal }>();
  for (const invoice of invoices) {
    const outstanding = new Prisma.Decimal(invoice.amount).minus(new Prisma.Decimal(invoice.amountPaid));
    if (invoice.status === "PENDING" || invoice.status === "PARTIAL") {
      pending = pending.plus(outstanding);
    }
    if (invoice.status === "OVERDUE") {
      overdue = overdue.plus(outstanding);
    }
    const slice = byStatus.get(invoice.status) ?? { count: 0, amount: new Prisma.Decimal(0) };
    slice.count += 1;
    slice.amount = slice.amount.plus(new Prisma.Decimal(invoice.amount));
    byStatus.set(invoice.status, slice);
  }

  const trendTotals = new Map<string, Prisma.Decimal>();
  for (const payment of windowPayments) {
    const m = schoolMonth(school.timezone, payment.paidAt);
    const k = `${m.year}-${String(m.month).padStart(2, "0")}`;
    trendTotals.set(k, (trendTotals.get(k) ?? new Prisma.Decimal(0)).plus(new Prisma.Decimal(payment.amount)));
  }

  const day = schoolDay(school.timezone, now);
  const board: AccountantDashboard = {
    totalCollected: new Prisma.Decimal(collected._sum.amount ?? 0).toFixed(2),
    pendingFees: pending.toFixed(2),
    overdueFees: overdue.toFixed(2),
    totalStudents,
    trend: months.map((m) => {
      const k = `${m.year}-${String(m.month).padStart(2, "0")}`;
      return { month: k, collected: (trendTotals.get(k) ?? new Prisma.Decimal(0)).toFixed(2) };
    }),
    byStatus: [...byStatus.entries()]
      .map(([status, slice]) => ({ status, count: slice.count, amount: slice.amount.toFixed(2) }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    recentTransactions: recent.map((p) => ({
      id: p.id,
      studentName: p.invoice.student.user.name,
      amount: new Prisma.Decimal(p.amount).toFixed(2),
      method: p.method,
      paidAt: p.paidAt.toISOString(),
      invoiceStatus: p.invoice.status,
    })),
    asOf: { day, month: `${year}-${String(month).padStart(2, "0")}` },
  };
  kpis.set(key, board);
  return board;
}

// Payments change every figure on this board; invoice generation changes
// pending/donut (new money owed). Both funnel here.
export function invalidateAccountantBoards(schoolId: string): void {
  kpis.deletePrefix(`kpi:aboard:${schoolId}:`);
}
