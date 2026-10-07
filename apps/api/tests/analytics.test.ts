import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { clearAnalyticsCache } from "../src/modules/metrics/analytics.service.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

function daysAgo(n: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n))
    .toISOString()
    .slice(0, 10);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Analytics School ${uid()}`,
      adminName: "Analytics Admin",
      adminEmail: `analytics-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSection(schoolId: string): Promise<{ sectionId: string; className: string }> {
  const className = `Class ${uid()}`;
  const cls = await prisma.class.create({ data: { schoolId, name: className } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  return { sectionId: section.id, className };
}

async function makePupil(schoolId: string, sectionId: string): Promise<string> {
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: `analytics-pupil-${uid()}@example.com`,
      passwordHash: "x",
      name: "Analytics Pupil",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  return student.id;
}

async function loginAs(schoolId: string, slug: string, role: string, tag: string): Promise<string> {
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  if (!roleRow) {
    throw new Error(`${role} role must be seeded`);
  }
  const email = `analytics-${tag}-${uid()}@example.com`;
  await prisma.user.create({
    data: { schoolId, roleId: roleRow.id, email, passwordHash: await bcrypt.hash("password-123", 4), name: `${tag} user` },
  });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: "password-123", schoolSlug: slug })
    .expect(200);
  return login.body.data.accessToken as string;
}

interface Overview {
  attendanceTrend: { date: string; percent: number | null; marked: number }[];
  feeTrend: { month: string; collected: string }[];
  pendingFees: string;
  overdueFees: string;
  exams: {
    examId: string;
    examName: string;
    takers: number;
    averagePercent: number | null;
    topPercent: number | null;
    distribution: { grade: string; count: number }[];
  }[];
  sections: { sectionId: string; className: string; sectionName: string; pupils: number; attendancePercent: number | null }[];
}

async function getOverview(schoolId: string, token: string): Promise<{ status: number; body: unknown }> {
  const res = await request(app)
    .get(`/api/v1/schools/${schoolId}/analytics/overview`)
    .set("Authorization", `Bearer ${token}`);
  return { status: res.status, body: res.body };
}

describe("GET analytics/overview (§7 Phase 3 #19 — admin analytics)", () => {
  it("returns exact trends, exam performance, and section rows for known data", async () => {
    clearAnalyticsCache();
    const { schoolId, adminToken } = await registerSchool();
    const { sectionId } = await makeSection(schoolId);
    const s1 = await makePupil(schoolId, sectionId);
    const s2 = await makePupil(schoolId, sectionId);

    const d2 = daysAgo(2);
    const d1 = daysAgo(1);
    await prisma.attendance.createMany({
      data: [
        { schoolId, studentId: s1, sectionId, date: new Date(`${d2}T00:00:00Z`), status: "PRESENT" },
        { schoolId, studentId: s2, sectionId, date: new Date(`${d2}T00:00:00Z`), status: "PRESENT" },
        { schoolId, studentId: s1, sectionId, date: new Date(`${d1}T00:00:00Z`), status: "PRESENT" },
        { schoolId, studentId: s2, sectionId, date: new Date(`${d1}T00:00:00Z`), status: "ABSENT" },
      ],
    });

    const cls = await prisma.class.findFirst({ where: { schoolId } });
    const structure = await prisma.feeStructure.create({
      data: { schoolId, classId: cls!.id, name: `Term ${uid()}`, amount: 500, term: "Term 1", category: "TUITION" },
    });
    const pending = await prisma.feeInvoice.create({
      data: { schoolId, studentId: s1, structureId: structure.id, amount: 200, amountPaid: 50, status: "PENDING", dueDate: new Date("2026-12-31T00:00:00Z") },
    });
    await prisma.feeInvoice.create({
      data: { schoolId, studentId: s2, structureId: structure.id, amount: 300, amountPaid: 0, status: "OVERDUE", dueDate: new Date("2026-01-31T00:00:00Z") },
    });
    await prisma.feePayment.create({
      data: { schoolId, invoiceId: pending.id, amount: 100, method: "CASH" },
    });

    const math = await prisma.subject.create({ data: { schoolId, name: `Mathematics ${uid()}`, group: "Core" } });
    const exam = await prisma.exam.create({ data: { schoolId, name: `Finals ${uid()}` } });
    const link = await prisma.examSubject.create({ data: { schoolId, examId: exam.id, subjectId: math.id, maxMarks: 100 } });
    await prisma.mark.create({ data: { schoolId, examSubjectId: link.id, studentId: s1, marksObtained: 80 } });
    await prisma.mark.create({ data: { schoolId, examSubjectId: link.id, studentId: s2, marksObtained: 95 } });

    const { status, body } = await getOverview(schoolId, adminToken);
    expect(status).toBe(200);
    const data = (body as { data: { analytics: Overview } }).data.analytics;

    const byDate = new Map(data.attendanceTrend.map((p) => [p.date, p]));
    expect(byDate.get(d2)).toMatchObject({ percent: 100, marked: 2 });
    expect(byDate.get(d1)).toMatchObject({ percent: 50, marked: 2 });
    expect(data.attendanceTrend).toHaveLength(30);

    expect(data.feeTrend).toHaveLength(6);
    const collectedTotal = data.feeTrend.reduce((sum, p) => sum + Number(p.collected), 0);
    expect(collectedTotal).toBe(100);
    expect(data.pendingFees).toBe("150.00");
    expect(data.overdueFees).toBe("300.00");

    expect(data.exams).toHaveLength(1);
    expect(data.exams[0]).toMatchObject({ takers: 2, averagePercent: 87.5, topPercent: 95 });
    const dist = new Map(data.exams[0]!.distribution.map((g) => [g.grade, g.count]));
    expect(dist.get("A+")).toBe(1);
    expect(dist.get("A")).toBe(0);
    expect(dist.get("B")).toBe(1);
    expect(dist.get("F")).toBe(0);

    expect(data.sections).toHaveLength(1);
    expect(data.sections[0]?.pupils).toBe(2);
  });

  it("refuses teachers, pupils, and stranger-school admins", async () => {
    clearAnalyticsCache();
    const { schoolId, slug, adminToken } = await registerSchool();
    const teacherToken = await loginAs(schoolId, slug, "TEACHER", "teacher");
    const pupilToken = await loginAs(schoolId, slug, "STUDENT", "pupil");

    expect((await getOverview(schoolId, teacherToken)).status).toBe(403);
    expect((await getOverview(schoolId, pupilToken)).status).toBe(403);

    const other = await registerSchool();
    expect((await getOverview(schoolId, other.adminToken)).status).toBe(403);
    // And the home school still serves its own admin.
    expect((await getOverview(schoolId, adminToken)).status).toBe(200);
  });

  it("honors attendanceDays/feeMonths windows and rejects out-of-range values", async () => {
    clearAnalyticsCache();
    const { schoolId, adminToken } = await registerSchool();
    const auth = { Authorization: `Bearer ${adminToken}` };

    const narrow = await request(app)
      .get(`/api/v1/schools/${schoolId}/analytics/overview?attendanceDays=7&feeMonths=3`)
      .set(auth)
      .expect(200);
    const narrowed = (narrow.body as { data: { analytics: Overview } }).data.analytics;
    expect(narrowed.attendanceTrend).toHaveLength(7);
    expect(narrowed.feeTrend).toHaveLength(3);

    await request(app)
      .get(`/api/v1/schools/${schoolId}/analytics/overview?attendanceDays=2`)
      .set(auth)
      .expect(400);
    await request(app)
      .get(`/api/v1/schools/${schoolId}/analytics/overview?feeMonths=99`)
      .set(auth)
      .expect(400);
  });

  it("excludes other schools' rows and refreshes after new marks (invalidation wired)", async () => {
    clearAnalyticsCache();
    const { schoolId, adminToken } = await registerSchool();
    const other = await registerSchool();
    const { sectionId } = await makeSection(schoolId);
    const pupil = await makePupil(schoolId, sectionId);

    const otherSection = await makeSection(other.schoolId);
    const otherPupil = await makePupil(other.schoolId, otherSection.sectionId);
    const d0 = daysAgo(0);
    await prisma.attendance.create({
      data: { schoolId: other.schoolId, studentId: otherPupil, sectionId: otherSection.sectionId, date: new Date(`${d0}T00:00:00Z`), status: "ABSENT" },
    });

    const before = (await getOverview(schoolId, adminToken).then((r) => r.body)) as { data: { analytics: Overview } };
    const todayPoint = before.data.analytics.attendanceTrend.find((p) => p.date === d0);
    // No rows of ours on that day: null, not the other school's absence.
    expect(todayPoint).toMatchObject({ percent: null, marked: 0 });

    // Marking through the API must evict the cached overview (not serve
    // 60s-stale zeros after a real write).
    await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId, date: d0, records: [{ studentId: pupil, status: "PRESENT" }] })
      .expect(200);

    const after = (await getOverview(schoolId, adminToken).then((r) => r.body)) as { data: { analytics: Overview } };
    expect(after.data.analytics.attendanceTrend.find((p) => p.date === d0)).toMatchObject({
      percent: 100,
      marked: 1,
    });
  });
});
