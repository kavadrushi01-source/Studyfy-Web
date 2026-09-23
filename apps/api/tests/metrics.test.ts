import { randomUUID } from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { LruCache } from "../src/lib/lru.js";
import { schoolDay, schoolDayBoundsUtc, schoolMonth, schoolMonthBoundsUtc } from "../src/lib/school-time.js";
import {
  clearKpiCache,
  getDashboardKpis,
  getMonthFeeCollection,
  getTodayAttendancePercent,
  getTotalStudents,
} from "../src/modules/metrics/metrics.service.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

beforeEach(() => {
  clearKpiCache();
});

describe("LruCache (§12.3)", () => {
  it("evicts the least-recently-used entry past capacity", () => {
    const cache = new LruCache<string>({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("B");
    expect(cache.get("c")).toBe("C");
    expect(cache.size).toBe(2);
  });

  it("refreshes recency on hit, so hot keys survive", () => {
    const cache = new LruCache<string>({ maxEntries: 2, ttlMs: 60_000 });
    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C");
    expect(cache.get("a")).toBe("A");
    expect(cache.get("b")).toBeUndefined();
  });

  it("expires entries after TTL and drops prefixes on demand", () => {
    let t = 1_000;
    const cache = new LruCache<string>({ maxEntries: 10, ttlMs: 500, now: () => t });
    cache.set("kpi:fees:S1:2026-09", "100.00");
    expect(cache.get("kpi:fees:S1:2026-09")).toBe("100.00");
    t += 501;
    expect(cache.get("kpi:fees:S1:2026-09")).toBeUndefined();

    cache.set("kpi:fees:S1:2026-10", "50.00");
    cache.set("kpi:fees:S2:2026-10", "70.00");
    cache.deletePrefix("kpi:fees:S1:");
    expect(cache.get("kpi:fees:S1:2026-10")).toBeUndefined();
    expect(cache.get("kpi:fees:S2:2026-10")).toBe("70.00");
  });

  it("rejects nonsense options instead of silently misbehaving", () => {
    expect(() => new LruCache<string>({ maxEntries: 0, ttlMs: 1000 })).toThrow();
    expect(() => new LruCache<string>({ maxEntries: 10, ttlMs: -1 })).toThrow();
  });
});

describe("school-time (§12.7)", () => {
  it("resolves the school day across the IST midnight boundary", () => {
    // 18:00Z = 23:30 IST (still the 21st); 19:00Z = 00:30 IST (the 22nd).
    expect(schoolDay("Asia/Kolkata", new Date("2026-09-21T18:00:00Z"))).toBe("2026-09-21");
    expect(schoolDay("Asia/Kolkata", new Date("2026-09-21T19:00:00Z"))).toBe("2026-09-22");
  });

  it("bounds an IST month in UTC (Sep 2026 = Aug 31 18:30Z → Sep 30 18:30Z)", () => {
    const { start, end } = schoolMonthBoundsUtc("Asia/Kolkata", 2026, 9);
    expect(start.toISOString()).toBe("2026-08-31T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(schoolMonth("Asia/Kolkata", new Date("2026-09-15T12:00:00Z"))).toEqual({ year: 2026, month: 9 });
  });

  it("bounds a DST month correctly (US Eastern, March 2026 springs forward)", () => {
    const { start, end } = schoolMonthBoundsUtc("America/New_York", 2026, 3);
    expect(start.toISOString()).toBe("2026-03-01T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-04-01T04:00:00.000Z");
  });

  it("bounds a school day in UTC, including a 23-hour DST day", () => {
    const plain = schoolDayBoundsUtc("Asia/Kolkata", "2026-09-22");
    expect(plain.start.toISOString()).toBe("2026-09-21T18:30:00.000Z");
    expect(plain.end.toISOString()).toBe("2026-09-22T18:30:00.000Z");
    // US Eastern springs forward 2026-03-08: local midnight still resolves,
    // and the day is 23 hours long, not 24.
    const dst = schoolDayBoundsUtc("America/New_York", "2026-03-08");
    expect(dst.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(dst.end.getTime() - dst.start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `KPI School ${uid()}`,
      adminName: "KPI Admin",
      adminEmail: `kpi-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  await prisma.school.update({ where: { id: schoolId }, data: { timezone: "Asia/Kolkata" } });
  return { schoolId, slug: res.body.data.school.slug as string, adminToken: res.body.data.accessToken as string };
}

async function makeSection(schoolId: string): Promise<{ sectionId: string; classId: string }> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  return { sectionId: section.id, classId: cls.id };
}

async function admit(schoolId: string, adminToken: string, sectionId: string): Promise<string> {
  const email = `kpi-pupil-${uid()}@example.com`;
  const res = await request(app)
    .post(`/api/v1/schools/${schoolId}/students`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "KPI Pupil",
      email,
      sectionId,
      admissionNo: `KPI-${uid()}`,
      gender: "Female",
      guardians: [{ name: "KPI Guardian", email: `kpi-guard-${uid()}@example.com`, relationship: "Mother" }],
    })
    .expect(201);
  return res.body.data.student.id as string;
}

async function setupFee(schoolId: string, adminToken: string, classId: string): Promise<string> {
  const structure = await request(app)
    .post(`/api/v1/schools/${schoolId}/fees/structures`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ classId, name: `KPI Term ${uid()}`, amount: "10000.00", term: "Term 1", category: "TUITION" })
    .expect(201);
  const structureId = structure.body.data.structure.id as string;
  const gen = await request(app)
    .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ structureId, classId, dueDate: "2026-12-31" })
    .expect(201);
  void gen;
  const invoice = await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId, structureId } });
  return invoice.id;
}

describe("dashboard KPIs (§12.3)", () => {
  it("computes students, today's attendance %, and month collection", async () => {
    const school = await registerSchool();
    const { sectionId, classId } = await makeSection(school.schoolId);
    const s1 = await admit(school.schoolId, school.adminToken, sectionId);
    const s2 = await admit(school.schoolId, school.adminToken, sectionId);
    const invoiceId = await setupFee(school.schoolId, school.adminToken, classId);

    const day = schoolDay("Asia/Kolkata", new Date());
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/attendance`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ sectionId, date: day, records: [{ studentId: s1, status: "PRESENT" }, { studentId: s2, status: "LATE" }] })
      .expect(200);
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/fees/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ amount: "2500.50", method: "CASH" })
      .expect(200);

    const kpis = await getDashboardKpis(prisma, school.schoolId);
    expect(kpis.totalStudents).toBe(2);
    // PRESENT (1) + LATE (0.5) over 2 marks = 75%.
    expect(kpis.todayAttendancePercent).toBe(75);
    expect(kpis.monthFeeCollection).toBe("2500.50");
    expect(kpis.asOf.day).toBe(day);
  },
  // Generous timeout: register + 2 admits + fee setup ≈ 6 bcrypt cost-12+
  // ops, same reason admission.test.ts carries 30s.
  30000);

  it("serves reads from cache and refreshes only on write (stale-proof)", async () => {
    const school = await registerSchool();
    const { sectionId } = await makeSection(school.schoolId);
    await admit(school.schoolId, school.adminToken, sectionId);
    expect(await getTotalStudents(prisma, school.schoolId)).toBe(1);

    // Bypass the write path (no invalidation): cache must serve stale.
    const admin = await prisma.user.findFirstOrThrow({ where: { schoolId: school.schoolId, role: { name: "SCHOOL_ADMIN" } } });
    const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
    const ghost = await prisma.user.create({
      data: { schoolId: school.schoolId, roleId: studentRole.id, email: `ghost-${uid()}@example.com`, passwordHash: "x", name: "Ghost" },
    });
    void admin;
    await prisma.student.create({ data: { schoolId: school.schoolId, userId: ghost.id, sectionId } });
    expect(await getTotalStudents(prisma, school.schoolId)).toBe(1);

    // A real admission invalidates → fresh count.
    await admit(school.schoolId, school.adminToken, sectionId);
    expect(await getTotalStudents(prisma, school.schoolId)).toBe(3);
  }, 30000);

  it("returns null attendance with no marks, and isolates schools", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const secA = await makeSection(schoolA.schoolId);
    const secB = await makeSection(schoolB.schoolId);
    await admit(schoolA.schoolId, schoolA.adminToken, secA.sectionId);
    await admit(schoolB.schoolId, schoolB.adminToken, secB.sectionId);

    const day = schoolDay("Asia/Kolkata", new Date());
    const pupilsA = await prisma.student.findMany({ where: { schoolId: schoolA.schoolId } });
    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/attendance`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ sectionId: secA.sectionId, date: day, records: [{ studentId: pupilsA[0]!.id, status: "PRESENT" }] })
      .expect(200);

    // A writes never leak into B's keys: B still shows its own count and
    // null attendance, and B's fee collection stays zero.
    expect(await getTodayAttendancePercent(prisma, schoolB.schoolId, "Asia/Kolkata")).toBeNull();
    expect(await getTotalStudents(prisma, schoolB.schoolId)).toBe(1);
    expect(await getMonthFeeCollection(prisma, schoolB.schoolId, "Asia/Kolkata")).toBe("0.00");
    expect(await getTodayAttendancePercent(prisma, schoolA.schoolId, "Asia/Kolkata")).toBe(100);
  }, 30000);

  it("refreshes month collection on payment, not on invoice creation", async () => {
    const school = await registerSchool();
    const { sectionId, classId } = await makeSection(school.schoolId);
    await admit(school.schoolId, school.adminToken, sectionId);
    expect(await getMonthFeeCollection(prisma, school.schoolId, "Asia/Kolkata")).toBe("0.00");

    // Generating invoices changes what is OWED, not what is COLLECTED.
    const invoiceId = await setupFee(school.schoolId, school.adminToken, classId);
    expect(await getMonthFeeCollection(prisma, school.schoolId, "Asia/Kolkata")).toBe("0.00");

    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/fees/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ amount: "1000", method: "CASH" })
      .expect(200);
    expect(await getMonthFeeCollection(prisma, school.schoolId, "Asia/Kolkata")).toBe("1000.00");
  }, 30000);

  it("404s an unknown school instead of returning cross-tenant numbers", async () => {
    await expect(getDashboardKpis(prisma, "school-that-does-not-exist")).rejects.toMatchObject({
      code: "SCHOOL_NOT_FOUND",
    });
  });
});
