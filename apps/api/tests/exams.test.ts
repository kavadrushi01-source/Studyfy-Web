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
      schoolName: `Exam School ${uid()}`,
      adminName: "Exam Admin",
      adminEmail: `exam-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSubjects(schoolId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const name of ["Mathematics", "English"]) {
    const subject = await prisma.subject.create({ data: { schoolId, name: `${name} ${uid()}`, group: "Core" } });
    ids.push(subject.id);
  }
  return ids;
}

async function loginAs(schoolId: string, slug: string, roleName: string): Promise<string> {
  const email = `exam-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "user-pass-123";
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`${roleName} role must be seeded`);
  }
  await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} User` },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

function examBody(subjectIds: string[]) {
  return {
    name: "Unit Test 2",
    startDate: "2026-10-01",
    endDate: "2026-10-07",
    subjects: subjectIds.map((subjectId, i) => ({
      subjectId,
      maxMarks: 50,
      examDate: `2026-10-0${i + 1}`,
    })),
  };
}

describe("POST /api/v1/schools/:schoolId/exams", () => {
  it("creates an exam with linked subjects in one action (admin + teacher)", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const subjectIds = await makeSubjects(schoolId);
    const teacherToken = await loginAs(schoolId, slug, "TEACHER");

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(examBody(subjectIds))
      .expect(201);

    expect(res.body.data.exam.name).toBe("Unit Test 2");
    expect(res.body.data.exam.examSubjects).toHaveLength(2);
    const row = await prisma.exam.findUnique({
      where: { id: res.body.data.exam.id as string },
      include: { examSubjects: true },
    });
    expect(row?.examSubjects).toHaveLength(2);
    expect(Number(row?.examSubjects[0]?.maxMarks)).toBe(50);

    // Teacher may also schedule.
    await request(app)
      .post(`/api/v1/schools/${schoolId}/exams`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ ...examBody(subjectIds), name: "Class Test 1" })
      .expect(201);

    // Everyone with exams.read sees the schedule.
    const list = await request(app)
      .get(`/api/v1/schools/${schoolId}/exams`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);
    expect((list.body.data.exams as { name: string }[]).map((e) => e.name).sort()).toEqual(
      ["Class Test 1", "Unit Test 2"],
    );
  });

  it("rejects students, dup subjects, bad ranges, foreign subjects, strangers", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const subjectsA = await makeSubjects(schoolA.schoolId);
    const subjectsB = await makeSubjects(schoolB.schoolId);
    const studentToken = await loginAs(schoolA.schoolId, schoolA.slug, "STUDENT");

    const denied = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/exams`)
      .set("Authorization", `Bearer ${studentToken}`)
      .send(examBody(subjectsA))
      .expect(403);
    expect(denied.body.error.code).toBe("PERMISSION_DENIED");

    const dupe = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/exams`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ ...examBody([subjectsA[0] ?? "", subjectsA[0] ?? ""]), name: "Dupe Test" })
      .expect(400);
    expect(dupe.body.error.code).toBe("VALIDATION_ERROR");

    const backwards = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/exams`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ ...examBody(subjectsA), name: "Backwards Test", startDate: "2026-10-07", endDate: "2026-10-01" })
      .expect(400);
    expect(backwards.body.error.code).toBe("VALIDATION_ERROR");

    const foreign = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/exams`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send(examBody(subjectsB))
      .expect(404);
    expect(foreign.body.error.code).toBe("SUBJECT_NOT_FOUND");

    const cross = await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/exams`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send(examBody(subjectsA))
      .expect(403);
    expect(cross.body.error.code).toBe("TENANT_MISMATCH");

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/exams`)
      .send(examBody(subjectsA))
      .expect(401);
  });
});
