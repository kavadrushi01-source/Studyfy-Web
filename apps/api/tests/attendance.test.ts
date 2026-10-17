import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Attendance School ${uid()}`,
      adminName: "Attendance Admin",
      adminEmail: `attendance-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSection(schoolId: string, name: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name } });
  return section.id;
}

async function makeStudent(schoolId: string, sectionId: string): Promise<string> {
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: `att-student-${uid()}@example.com`,
      passwordHash: "x",
      name: "Attendance Student",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  return student.id;
}

async function makeTeacher(
  schoolId: string,
  slug: string,
  roleName: string,
  classTeacherOf: string | null,
): Promise<string> {
  const email = `att-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "staff-pass-123";
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`${roleName} role must be seeded`);
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} User` },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: roleName } });
  if (classTeacherOf) {
    await prisma.section.update({ where: { id: classTeacherOf }, data: { classTeacherId: staff.id } });
  }
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

const DAY = "2026-09-10";

describe("POST /api/v1/schools/:schoolId/attendance (bulk marking)", () => {
  it("lets School Admin bulk-mark a section, and re-marking overwrites (upsert)", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId, "A");
    const s1 = await makeStudent(schoolId, sectionId);
    const s2 = await makeStudent(schoolId, sectionId);

    const first = await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        sectionId,
        date: DAY,
        records: [
          { studentId: s1, status: "PRESENT" },
          { studentId: s2, status: "LATE" },
        ],
      })
      .expect(200);
    expect(first.body.data.marked).toBe(2);

    const rows = await prisma.attendance.findMany({ where: { schoolId, sectionId } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.studentId === s1)?.status).toBe("PRESENT");

    // Re-mark: same day overwrites, no duplicate rows.
    await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId, date: DAY, records: [{ studentId: s1, status: "ABSENT" }] })
      .expect(200);
    const again = await prisma.attendance.findMany({ where: { schoolId, sectionId } });
    expect(again).toHaveLength(2);
    expect(again.find((r) => r.studentId === s1)?.status).toBe("ABSENT");
  });

  it("lets the assigned class teacher mark (stamped as marker), blocks an unassigned teacher with 403", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    void adminToken;
    const sectionA = await makeSection(schoolId, "A");
    const sectionB = await makeSection(schoolId, "B");
    const studentA = await makeStudent(schoolId, sectionA);
    const teacherA = await makeTeacher(schoolId, slug, "TEACHER", sectionA);
    const teacherB = await makeTeacher(schoolId, slug, "TEACHER", sectionB);
    const teacherNone = await makeTeacher(schoolId, slug, "TEACHER", null);

    const ok = await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${teacherA}`)
      .send({ sectionId: sectionA, date: DAY, records: [{ studentId: studentA, status: "PRESENT" }] })
      .expect(200);
    expect(ok.body.data.marked).toBe(1);
    const row = await prisma.attendance.findFirst({ where: { schoolId, studentId: studentA } });
    expect(row?.markedById).not.toBeNull();

    for (const token of [teacherB, teacherNone]) {
      const denied = await request(app)
        .post(`/api/v1/schools/${schoolId}/attendance`)
        .set("Authorization", `Bearer ${token}`)
        .send({ sectionId: sectionA, date: DAY, records: [{ studentId: studentA, status: "PRESENT" }] })
        .expect(403);
      expect(denied.body.error.code).toBe("NOT_SECTION_TEACHER");
    }
  });

  it("rejects students from another section, bad input, and keyless roles", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId, "A");
    const sectionB = await makeSection(schoolId, "B");
    const outsider = await makeStudent(schoolId, sectionB);
    const insider = await makeStudent(schoolId, sectionA);
    const accountant = await makeTeacher(schoolId, slug, "ACCOUNTANT", null);

    const mixed = await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId: sectionA, date: DAY, records: [{ studentId: outsider, status: "PRESENT" }] })
      .expect(400);
    expect(mixed.body.error.code).toBe("STUDENT_NOT_IN_SECTION");

    const badStatus = await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId: sectionA, date: DAY, records: [{ studentId: insider, status: "SLEEPING" }] })
      .expect(400);
    expect(badStatus.body.error.code).toBe("VALIDATION_ERROR");

    const badDate = await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId: sectionA, date: "10-09-2026", records: [{ studentId: insider, status: "PRESENT" }] })
      .expect(400);
    expect(badDate.body.error.code).toBe("VALIDATION_ERROR");

    const futureDate = await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId: sectionA, date: "2999-01-01", records: [{ studentId: insider, status: "PRESENT" }] })
      .expect(400);
    expect(futureDate.body.error.code).toBe("VALIDATION_ERROR");

    const noKey = await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${accountant}`)
      .send({ sectionId: sectionA, date: DAY, records: [{ studentId: insider, status: "PRESENT" }] })
      .expect(403);
    expect(noKey.body.error.code).toBe("PERMISSION_DENIED");

    const duplicate = await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        sectionId: sectionA,
        date: DAY,
        records: [
          { studentId: insider, status: "PRESENT" },
          { studentId: insider, status: "ABSENT" },
        ],
      })
      .expect(400);
    expect(duplicate.body.error.code).toBe("VALIDATION_ERROR");

    await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .send({ sectionId: sectionA, date: DAY, records: [{ studentId: insider, status: "PRESENT" }] })
      .expect(401);
  });
});

describe("GET /api/v1/schools/:schoolId/attendance (daily roster hydration)", () => {
  it("returns saved statuses for the section+day, empty for an unmarked day", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId, "A");
    const s1 = await makeStudent(schoolId, sectionId);
    const s2 = await makeStudent(schoolId, sectionId);

    await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        sectionId,
        date: DAY,
        records: [
          { studentId: s1, status: "PRESENT" },
          { studentId: s2, status: "ABSENT" },
        ],
      })
      .expect(200);

    const day = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance?date=${DAY}&sectionId=${sectionId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const records = day.body.data.records as { studentId: string; status: string }[];
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.studentId === s1)?.status).toBe("PRESENT");
    expect(records.find((r) => r.studentId === s2)?.status).toBe("ABSENT");

    const otherDay = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance?date=2026-09-11&sectionId=${sectionId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(otherDay.body.data.records).toHaveLength(0);
  });

  it("mirrors the marking gate: class teacher in, other staff out, bad input rejected", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    void adminToken;
    const sectionA = await makeSection(schoolId, "A");
    const sectionB = await makeSection(schoolId, "B");
    await makeStudent(schoolId, sectionA);
    const teacherA = await makeTeacher(schoolId, slug, "TEACHER", sectionA);
    const teacherB = await makeTeacher(schoolId, slug, "TEACHER", sectionB);
    const teacherNone = await makeTeacher(schoolId, slug, "TEACHER", null);
    const accountant = await makeTeacher(schoolId, slug, "ACCOUNTANT", null);

    const allowed = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance?date=${DAY}&sectionId=${sectionA}`)
      .set("Authorization", `Bearer ${teacherA}`)
      .expect(200);
    expect(Array.isArray(allowed.body.data.records)).toBe(true);

    for (const token of [teacherB, teacherNone]) {
      const denied = await request(app)
        .get(`/api/v1/schools/${schoolId}/attendance?date=${DAY}&sectionId=${sectionA}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(403);
      expect(denied.body.error.code).toBe("NOT_SECTION_TEACHER");
    }

    const noKey = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance?date=${DAY}&sectionId=${sectionA}`)
      .set("Authorization", `Bearer ${accountant}`)
      .expect(403);
    expect(noKey.body.error.code).toBe("PERMISSION_DENIED");

    await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance?date=${DAY}&sectionId=${sectionA}`)
      .expect(401);

    const badDate = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance?date=10-09-2026&sectionId=${sectionA}`)
      .set("Authorization", `Bearer ${teacherA}`)
      .expect(400);
    expect(badDate.body.error.code).toBe("VALIDATION_ERROR");

    const missingSection = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance?date=${DAY}&sectionId=`)
      .set("Authorization", `Bearer ${teacherA}`)
      .expect(400);
    expect(missingSection.body.error.code).toBe("VALIDATION_ERROR");

    const unknownSection = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance?date=${DAY}&sectionId=${randomUUID().slice(0, 24)}`)
      .set("Authorization", `Bearer ${teacherA}`)
      .expect(404);
    expect(unknownSection.body.error.code).toBe("SECTION_NOT_FOUND");
  });
});
