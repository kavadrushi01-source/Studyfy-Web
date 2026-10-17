import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { attendanceSummary } from "../src/modules/attendance/attendance.service.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Summary School ${uid()}`,
      adminName: "Summary Admin",
      adminEmail: `summary-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSection(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  return section.id;
}

async function makeStudent(
  schoolId: string,
  sectionId: string,
  password = "student-pass-123",
): Promise<{ token: string; studentId: string }> {
  const email = `sum-student-${uid()}@example.com`;
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Summary Student" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, schoolSlug: (await prisma.school.findUnique({ where: { id: schoolId } }))?.slug })
    .expect(200);
  return { token: login.body.data.accessToken as string, studentId: student.id };
}

async function mark(
  token: string,
  schoolId: string,
  sectionId: string,
  date: string,
  records: { studentId: string; status: string }[],
): Promise<void> {
  await request(app)
    .post(`/api/v1/schools/${schoolId}/attendance`)
    .set("Authorization", `Bearer ${token}`)
    .send({ sectionId, date, records })
    .expect(200);
}

describe("GET /api/v1/schools/:schoolId/attendance/summary", () => {
  it("computes prefix-sum % over a custom range (P,P,A,L = 62.5%)", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const s1 = await makeStudent(schoolId, sectionId);
    const s2 = await makeStudent(schoolId, sectionId);

    await mark(adminToken, schoolId, sectionId, "2026-09-01", [
      { studentId: s1.studentId, status: "PRESENT" },
      { studentId: s2.studentId, status: "PRESENT" },
    ]);
    await mark(adminToken, schoolId, sectionId, "2026-09-02", [
      { studentId: s1.studentId, status: "PRESENT" },
      { studentId: s2.studentId, status: "ABSENT" },
    ]);
    await mark(adminToken, schoolId, sectionId, "2026-09-03", [
      { studentId: s1.studentId, status: "ABSENT" },
      { studentId: s2.studentId, status: "ABSENT" },
    ]);
    await mark(adminToken, schoolId, sectionId, "2026-09-04", [
      { studentId: s1.studentId, status: "LATE" },
      { studentId: s2.studentId, status: "ABSENT" },
    ]);

    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/summary?from=2026-09-01&to=2026-09-04`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.range).toEqual({ from: "2026-09-01", to: "2026-09-04" });
    const rows = res.body.data.summary as { studentId: string; total: number; present: number; percent: number }[];
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.studentId === s1.studentId);
    expect(first).toMatchObject({ total: 4, present: 2.5, percent: 62.5 });
    const second = rows.find((r) => r.studentId === s2.studentId);
    expect(second).toMatchObject({ total: 4, present: 1, percent: 25 });
  });

  it("defaults a student to their own record, and 403s another student's id", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const s1 = await makeStudent(schoolId, sectionId);
    const s2 = await makeStudent(schoolId, sectionId);
    await mark(adminToken, schoolId, sectionId, "2026-09-05", [{ studentId: s1.studentId, status: "PRESENT" }]);

    const own = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/summary?from=2026-09-05&to=2026-09-05`)
      .set("Authorization", `Bearer ${s1.token}`)
      .expect(200);
    expect((own.body.data.summary as { studentId: string }[]).map((r) => r.studentId)).toEqual([s1.studentId]);

    const other = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/summary?from=2026-09-05&to=2026-09-05&studentId=${s2.studentId}`)
      .set("Authorization", `Bearer ${s1.token}`)
      .expect(403);
    expect(other.body.error.code).toBe("FORBIDDEN");
  });

  it("filters by section for staff and validates the range", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId);
    const sectionB = await makeSection(schoolId);
    const s1 = await makeStudent(schoolId, sectionA);
    const s2 = await makeStudent(schoolId, sectionB);
    await mark(adminToken, schoolId, sectionA, "2026-09-06", [{ studentId: s1.studentId, status: "PRESENT" }]);
    await mark(adminToken, schoolId, sectionB, "2026-09-06", [{ studentId: s2.studentId, status: "PRESENT" }]);

    const filtered = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/summary?from=2026-09-06&to=2026-09-06&sectionId=${sectionA}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect((filtered.body.data.summary as { studentId: string }[]).map((r) => r.studentId)).toEqual([s1.studentId]);

    const badRange = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/summary?from=2026-09-06&to=2026-09-01`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
    expect(badRange.body.error.code).toBe("VALIDATION_ERROR");

    const impossible = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/summary?from=2026-02-30&to=2026-03-05`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
    expect(impossible.body.error.code).toBe("VALIDATION_ERROR");

    await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/summary?month=2026-13`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
  });

  it("defaults an omitted month to the school's calendar month, not UTC", async () => {
    const { schoolId } = await registerSchool();
    await prisma.school.update({ where: { id: schoolId }, data: { timezone: "Pacific/Kiritimati" } });
    const sectionId = await makeSection(schoolId);
    const student = await makeStudent(schoolId, sectionId);
    await prisma.attendance.create({
      data: { schoolId, studentId: student.studentId, sectionId, date: new Date("2026-08-31T00:00:00Z"), status: "PRESENT" },
    });
    await prisma.attendance.create({
      data: { schoolId, studentId: student.studentId, sectionId, date: new Date("2026-09-01T00:00:00Z"), status: "PRESENT" },
    });

    const result = await attendanceSummary(prisma, {}, [student.studentId], {
      timezone: "Pacific/Kiritimati",
      now: new Date("2026-08-31T10:00:00Z"),
    });
    expect(result.range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(result.summary.map((row) => row.total)).toEqual([1]);
  });
});
