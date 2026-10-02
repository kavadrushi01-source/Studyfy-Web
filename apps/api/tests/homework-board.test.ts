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

async function makeSection(schoolId: string, name = "A"): Promise<string> {
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
  subjects: string[],
  classTeacherOf: string | null,
): Promise<string> {
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
  return login.body.data.accessToken as string;
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

async function postAs(
  schoolId: string,
  token: string,
  sectionId: string,
  subjectId: string,
  title: string,
): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/schools/${schoolId}/homework`)
    .set("Authorization", `Bearer ${token}`)
    .send({ sectionId, subjectId, title, description: "Board fixture homework body.", dueDate: "2026-11-01" })
    .expect(201);
  return res.body.data.homework.id as string;
}

interface BoardItem {
  id: string;
  title: string;
  mySubmissions: { studentId: string; status: string }[];
  counts: { total: number; submitted: number; graded: number } | null;
  pending:
    | { id: string; studentName: string; content: string | null; fileUrl: string | null; submittedAt: string }[]
    | null;
}

describe("GET /api/v1/schools/:schoolId/homework (boards)", () => {
  it("shapes rows per role: student pins, teacher counts, admin everything", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId, "A");
    const sectionB = await makeSection(schoolId, "B");
    const math = await makeSubject(schoolId);
    const teacherToken = await makeTeacher(schoolId, slug, [math], sectionA);
    const pupil = await makeStudent(schoolId, slug, sectionA);
    const hwA = await postAs(schoolId, teacherToken, sectionA, math, "Section A Worksheet");
    const hwB = await postAs(schoolId, adminToken, sectionB, math, "Section B Worksheet");
    void hwB;

    // Student: only section A's row, with empty submission state.
    const studentBoard = await request(app)
      .get(`/api/v1/schools/${schoolId}/homework`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(200);
    const studentRows = studentBoard.body.data.homework as BoardItem[];
    expect(studentRows.map((r) => r.id)).toEqual([hwA]);
    expect(studentRows[0]?.mySubmissions).toEqual([]);
    expect(studentRows[0]?.counts).toBeNull();

    // Submit, then it shows as submitted (pending, not graded).
    await request(app)
      .post(`/api/v1/schools/${schoolId}/homework/${hwA}/submissions`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .field("content", "My answers.")
      .expect(201);
    const after = await request(app)
      .get(`/api/v1/schools/${schoolId}/homework`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(200);
    const row = (after.body.data.homework as BoardItem[])[0];
    expect(row?.mySubmissions).toEqual([{ studentId: pupil.studentId, status: "SUBMITTED" }]);

    // Teacher: authored rows (hwA directly; hwB attributed — the admin
    // fallback assigns the only qualified teacher), with grading counts.
    const teacherBoard = await request(app)
      .get(`/api/v1/schools/${schoolId}/homework`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);
    const teacherRows = teacherBoard.body.data.homework as BoardItem[];
    expect(teacherRows.map((r) => r.id).sort()).toEqual([hwA, hwB].sort());
    const hwARow = teacherRows.find((r) => r.id === hwA);
    expect(hwARow?.counts).toEqual({ total: 1, submitted: 1, graded: 0 });
    // Pending carries gradeable ids + names (no ID hunting in the UI)...
    expect(hwARow?.pending).toHaveLength(1);
    expect(hwARow?.pending?.[0]?.studentName).toBe("Board Student");
    // ...AND the work itself, so the teacher reads before grading.
    expect(hwARow?.pending?.[0]?.content).toBe("My answers.");
    expect(hwARow?.pending?.[0]?.fileUrl).toBeNull();
    expect(typeof hwARow?.pending?.[0]?.submittedAt).toBe("string");

    // ...while pupils see none of it (no other pupil's submission ids leak).
    const pupilRow = (after.body.data.homework as BoardItem[])[0];
    expect(pupilRow?.pending).toBeNull();

    // Admin: everything.
    const adminBoard = await request(app)
      .get(`/api/v1/schools/${schoolId}/homework`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect((adminBoard.body.data.homework as BoardItem[]).map((r) => r.id).sort()).toEqual(
      [hwA, hwB].sort(),
    );
  });

  it("returns an empty board (not an error) with nothing assigned, and 401s strangers", async () => {
    const { schoolId, slug } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const pupil = await makeStudent(schoolId, slug, sectionId);

    const empty = await request(app)
      .get(`/api/v1/schools/${schoolId}/homework`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(200);
    expect(empty.body.data.homework).toEqual([]);

    await request(app).get(`/api/v1/schools/${schoolId}/homework`).expect(401);
  });
});
