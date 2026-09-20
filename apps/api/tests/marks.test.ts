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
      schoolName: `Marks School ${uid()}`,
      adminName: "Marks Admin",
      adminEmail: `marks-admin-${uid()}@example.com`,
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

async function makeStudent(schoolId: string, sectionId: string): Promise<string> {
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: `marks-student-${uid()}@example.com`,
      passwordHash: "x",
      name: "Marks Student",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  return student.id;
}

async function makeTeacher(
  schoolId: string,
  slug: string,
  classTeacherOf: string | null,
): Promise<string> {
  const email = `marks-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  if (!role) {
    throw new Error("TEACHER role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Marks Teacher" },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  if (classTeacherOf) {
    await prisma.section.update({ where: { id: classTeacherOf }, data: { classTeacherId: staff.id } });
  }
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

async function makeExam(
  schoolId: string,
  adminToken: string,
): Promise<{ examId: string; examSubjectId: string; maxMarks: number }> {
  const math = await prisma.subject.create({ data: { schoolId, name: `Mathematics ${uid()}`, group: "Core" } });
  const res = await request(app)
    .post(`/api/v1/schools/${schoolId}/exams`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Unit Test 1", subjects: [{ subjectId: math.id, maxMarks: 50 }] })
    .expect(201);
  const link = res.body.data.exam.examSubjects[0] as { id: string; maxMarks: string };
  return { examId: res.body.data.exam.id as string, examSubjectId: link.id, maxMarks: Number(link.maxMarks) };
}

describe("POST /api/v1/schools/:schoolId/exams/:examId/marks", () => {
  it("lets the class teacher enter a section in bulk, and re-entry overwrites", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const s1 = await makeStudent(schoolId, sectionId);
    const s2 = await makeStudent(schoolId, sectionId);
    const teacherToken = await makeTeacher(schoolId, slug, sectionId);
    const exam = await makeExam(schoolId, adminToken);

    const first = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/marks`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({
        examSubjectId: exam.examSubjectId,
        sectionId,
        records: [
          { studentId: s1, marksObtained: 42 },
          { studentId: s2, marksObtained: 35 },
        ],
      })
      .expect(200);
    expect(first.body.data.entered).toBe(2);

    const rows = await prisma.mark.findMany({ where: { schoolId, examSubjectId: exam.examSubjectId } });
    expect(rows).toHaveLength(2);
    expect(Number(rows.find((r) => r.studentId === s1)?.marksObtained)).toBe(42);

    await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/marks`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ examSubjectId: exam.examSubjectId, sectionId, records: [{ studentId: s1, marksObtained: 47 }] })
      .expect(200);
    const again = await prisma.mark.findMany({ where: { schoolId, examSubjectId: exam.examSubjectId } });
    expect(again).toHaveLength(2);
    expect(Number(again.find((r) => r.studentId === s1)?.marksObtained)).toBe(47);
  });

  it("blocks unassigned teachers, out-of-range marks, outsiders, and keyless roles", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId);
    const sectionB = await makeSection(schoolId);
    const studentA = await makeStudent(schoolId, sectionA);
    const studentB = await makeStudent(schoolId, sectionB);
    const teacherB = await makeTeacher(schoolId, slug, sectionB);
    const teacherNone = await makeTeacher(schoolId, slug, null);
    const exam = await makeExam(schoolId, adminToken);
    const payload = (records: { studentId: string; marksObtained: number }[]) => ({
      examSubjectId: exam.examSubjectId,
      sectionId: sectionA,
      records,
    });

    for (const token of [teacherB, teacherNone]) {
      const denied = await request(app)
        .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/marks`)
        .set("Authorization", `Bearer ${token}`)
        .send(payload([{ studentId: studentA, marksObtained: 40 }]))
        .expect(403);
      expect(denied.body.error.code).toBe("NOT_SECTION_TEACHER");
    }

    const over = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/marks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload([{ studentId: studentA, marksObtained: exam.maxMarks + 1 }]))
      .expect(400);
    expect(over.body.error.code).toBe("MARKS_EXCEED_MAXIMUM");

    const negative = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/marks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload([{ studentId: studentA, marksObtained: -1 }]))
      .expect(400);
    expect(negative.body.error.code).toBe("VALIDATION_ERROR");

    const outsider = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/marks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload([{ studentId: studentB, marksObtained: 40 }]))
      .expect(400);
    expect(outsider.body.error.code).toBe("STUDENT_NOT_IN_SECTION");

    // Wrong subject link for this exam.
    const wrongExam = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/marks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ examSubjectId: "cmu00000000000000000000000", sectionId: sectionA, records: [{ studentId: studentA, marksObtained: 40 }] })
      .expect(404);
    expect(wrongExam.body.error.code).toBe("EXAM_SUBJECT_NOT_FOUND");

    await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/marks`)
      .send(payload([{ studentId: studentA, marksObtained: 40 }]))
      .expect(401);
  });
});
