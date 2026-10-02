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
      schoolName: `Board School ${uid()}`,
      adminName: "Board Admin",
      adminEmail: `board-admin-${uid()}@example.com`,
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

async function makeSubject(schoolId: string): Promise<string> {
  const subject = await prisma.subject.create({ data: { schoolId, name: `Subject ${uid()}`, group: "Core" } });
  return subject.id;
}

async function makeTeacher(
  schoolId: string,
  slug: string,
  classTeacherOf: string | null,
  subjects: string[],
): Promise<{ token: string; staffId: string }> {
  const email = `board-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  if (!role) {
    throw new Error("TEACHER role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Board Teacher" },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  if (classTeacherOf) {
    await prisma.section.update({ where: { id: classTeacherOf }, data: { classTeacherId: staff.id } });
  }
  for (const subjectId of subjects) {
    await prisma.teacherSubject.create({ data: { schoolId, staffId: staff.id, subjectId } });
  }
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, staffId: staff.id };
}

async function makeStudent(
  schoolId: string,
  slug: string,
  sectionId: string,
): Promise<{ token: string; studentId: string }> {
  const email = `board-student-${uid()}@example.com`;
  const password = "student-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Board Student" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, studentId: student.id };
}

async function generate(
  schoolId: string,
  adminToken: string,
  sectionId: string,
  subjectId: string,
): Promise<void> {
  await request(app)
    .post(`/api/v1/schools/${schoolId}/timetable/generate`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ demands: [{ sectionId, subjectId, periodsPerWeek: 2 }], days: [1, 2], periodsPerDay: 3 })
    .expect(200);
}

describe("GET /api/v1/schools/:schoolId/timetable (boards)", () => {
  it("shows staff the section board; students only their own section", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId, "A");
    const sectionB = await makeSection(schoolId, "B");
    const math = await makeSubject(schoolId);
    const teacher = await makeTeacher(schoolId, slug, sectionA, [math]);
    void teacher;
    const pupil = await makeStudent(schoolId, slug, sectionA);
    await generate(schoolId, adminToken, sectionA, math);
    await generate(schoolId, adminToken, sectionB, math);

    const board = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable?sectionId=${sectionA}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect((board.body.data.slots as { section: { id: string } }[]).length).toBeGreaterThan(0);
    for (const slot of board.body.data.slots as { section: { id: string } }[]) {
      expect(slot.section.id).toBe(sectionA);
    }

    const own = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable?sectionId=${sectionA}`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(200);
    expect((own.body.data.slots as unknown[]).length).toBeGreaterThan(0);

    const other = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable?sectionId=${sectionB}`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(403);
    expect(other.body.error.code).toBe("FORBIDDEN");
  });

  it("gives teachers their own board and blocks anyone else's", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId, "A");
    const math = await makeSubject(schoolId);
    const teacherA = await makeTeacher(schoolId, slug, sectionA, [math]);
    const teacherB = await makeTeacher(schoolId, slug, null, [math]);
    await generate(schoolId, adminToken, sectionA, math);

    const mine = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable?teacherId=${teacherA.staffId}`)
      .set("Authorization", `Bearer ${teacherA.token}`)
      .expect(200);
    expect((mine.body.data.slots as unknown[]).length).toBeGreaterThan(0);
    for (const slot of mine.body.data.slots as { teacher: { id: string } }[]) {
      expect(slot.teacher.id).toBe(teacherA.staffId);
    }

    const theirs = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable?teacherId=${teacherA.staffId}`)
      .set("Authorization", `Bearer ${teacherB.token}`)
      .expect(403);
    expect(theirs.body.error.code).toBe("FORBIDDEN");

    // Students have no teaching relationship: teacher lens always denied.
    const pupil = await makeStudent(schoolId, slug, sectionA);
    const studentLens = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable?teacherId=${teacherA.staffId}`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(403);
    expect(studentLens.body.error.code).toBe("FORBIDDEN");
  });

  it("mine=true resolves the teacher from the session; anyone else is refused", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId, "A");
    const math = await makeSubject(schoolId);
    const teacherA = await makeTeacher(schoolId, slug, sectionA, [math]);
    await generate(schoolId, adminToken, sectionA, math);

    // Teacher: own week, no ID needed — every slot is theirs.
    const mine = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable?mine=true`)
      .set("Authorization", `Bearer ${teacherA.token}`)
      .expect(200);
    expect((mine.body.data.slots as unknown[]).length).toBeGreaterThan(0);
    for (const slot of mine.body.data.slots as { teacher: { id: string }; id: string }[]) {
      expect(slot.teacher.id).toBe(teacherA.staffId);
      expect(typeof slot.id).toBe("string");
    }

    // Non-teachers have no personal timetable.
    const pupil = await makeStudent(schoolId, slug, sectionA);
    const studentMine = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable?mine=true`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(403);
    expect(studentMine.body.error.code).toBe("FORBIDDEN");

    const adminMine = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable?mine=true`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);
    expect(adminMine.body.error.code).toBe("FORBIDDEN");

    // mine combined with another lens is still exactly-one-lens.
    await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable?mine=true&sectionId=${sectionA}`)
      .set("Authorization", `Bearer ${teacherA.token}`)
      .expect(400);
  });

  it("validates lens choice and rejects strangers", async () => {
    const { schoolId, adminToken } = await registerSchool();

    const neither = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
    expect(neither.body.error.code).toBe("VALIDATION_ERROR");

    const both = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable?sectionId=x&teacherId=y`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
    expect(both.body.error.code).toBe("VALIDATION_ERROR");

    await request(app).get(`/api/v1/schools/${schoolId}/timetable?sectionId=x`).expect(401);
  });
});
