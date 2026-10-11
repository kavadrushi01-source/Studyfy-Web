import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { setGroqClient, stubGroqClient } from "../src/lib/groq.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

const savedKey = process.env.GROQ_API_KEY;

afterEach(() => {
  setGroqClient(null);
  if (savedKey === undefined) {
    delete process.env.GROQ_API_KEY;
  } else {
    process.env.GROQ_API_KEY = savedKey;
  }
});

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Remark Gen School ${uid()}`,
      adminName: "Remark Admin",
      adminEmail: `remark-gen-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  // Phase 3 module under test (§16.1): this fixture school buys Premium.
  // Plan-gating itself is proven in billing-gating.test.ts.
  const schoolId = res.body.data.school.id as string;
  await prisma.school.update({ where: { id: schoolId }, data: { plan: "PREMIUM", subscriptionStatus: "ACTIVE" } });
  return {
    schoolId,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSection(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: `S${uid()}` } });
  return section.id;
}

async function makeLogin(
  schoolId: string,
  slug: string,
  role: string,
  tag: string,
  displayName: string,
): Promise<{ userId: string; token: string; email: string }> {
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  if (!roleRow) {
    throw new Error(`${role} role must be seeded`);
  }
  const email = `remark-gen-${tag}-${uid()}@example.com`;
  const password = "password-123";
  const user = await prisma.user.create({
    data: { schoolId, roleId: roleRow.id, email, passwordHash: await bcrypt.hash(password, 4), name: displayName },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { userId: user.id, token: login.body.data.accessToken as string, email };
}

async function makeTeacher(
  schoolId: string,
  slug: string,
  classTeacherOf: string | null,
): Promise<string> {
  const { userId, token } = await makeLogin(schoolId, slug, "TEACHER", "teacher", "Remark Teacher");
  const staff = await prisma.staff.create({ data: { schoolId, userId, designation: "Teacher" } });
  if (classTeacherOf) {
    await prisma.section.update({ where: { id: classTeacherOf }, data: { classTeacherId: staff.id } });
  }
  return token;
}

async function makeStudentUser(
  schoolId: string,
  slug: string,
  sectionId: string,
  displayName: string,
): Promise<{ studentId: string; token: string }> {
  const { userId, token } = await makeLogin(schoolId, slug, "STUDENT", "pupil", displayName);
  const student = await prisma.student.create({ data: { schoolId, userId, sectionId } });
  return { studentId: student.id, token };
}

async function makeExam(
  schoolId: string,
  adminToken: string,
  dates?: { startDate: string; endDate: string },
): Promise<{ examId: string; examSubjectId: string }> {
  const math = await prisma.subject.create({ data: { schoolId, name: `Mathematics ${uid()}`, group: "Core" } });
  const res = await request(app)
    .post(`/api/v1/schools/${schoolId}/exams`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `Remark Exam ${uid()}`, subjects: [{ subjectId: math.id, maxMarks: 100 }], ...dates })
    .expect(201);
  const link = res.body.data.exam.examSubjects[0] as { id: string };
  return { examId: res.body.data.exam.id as string, examSubjectId: link.id };
}

async function enterMark(schoolId: string, examSubjectId: string, studentId: string, obtained: number): Promise<void> {
  await prisma.mark.create({ data: { schoolId, examSubjectId, studentId, marksObtained: obtained } });
}

describe("POST /schools/:schoolId/exams/:examId/remarks/generate (§7 Phase 3 #18)", () => {
  it("class teacher generates an UNREVIEWED AI remark from marks, prompt carries no pupil name", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const { studentId } = await makeStudentUser(schoolId, slug, sectionId, "Aarav Remarkable");
    const teacherToken = await makeTeacher(schoolId, slug, sectionId);
    const exam = await makeExam(schoolId, adminToken);
    await enterMark(schoolId, exam.examSubjectId, studentId, 85);

    const stub = stubGroqClient("This student shows steady progress.");
    setGroqClient(stub);

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/remarks/generate`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ studentId })
      .expect(201);

    expect(res.body.data.remark.remark).toBe("This student shows steady progress.");
    expect(res.body.data.remark.generatedBy).toBe("AI");
    expect(res.body.data.remark.reviewed).toBe(false);

    const row = await prisma.examRemark.findUnique({ where: { id: res.body.data.remark.id as string } });
    expect(row?.schoolId).toBe(schoolId);
    expect(row?.generatedBy).toBe("AI");
    expect(row?.reviewed).toBe(false);

    expect(stub.calls).toHaveLength(1);
    const prompt = stub.calls[0]?.prompt ?? "";
    expect(prompt).toContain("this student");
    expect(prompt).toContain("85/100");
    expect(prompt).not.toContain("Aarav Remarkable");
  });

  it("school admin may generate; attendance appears in the prompt inside the exam window", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const { studentId } = await makeStudentUser(schoolId, slug, sectionId, "Ananya Attendee");
    const exam = await makeExam(schoolId, adminToken, { startDate: "2026-09-01", endDate: "2026-09-30" });
    await enterMark(schoolId, exam.examSubjectId, studentId, 72);
    await prisma.attendance.create({
      data: { schoolId, studentId, sectionId, date: new Date("2026-09-10T00:00:00Z"), status: "PRESENT" },
    });

    const stub = stubGroqClient("This student attends regularly and performs well.");
    setGroqClient(stub);

    await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/remarks/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ studentId })
      .expect(201);

    const prompt = stub.calls[0]?.prompt ?? "";
    expect(prompt).toContain("Attendance during the exam window:");
    expect(prompt).not.toContain("Ananya Attendee");
  });

  it("refuses pupils, parents, unassigned teachers, and stranger-school admins", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const otherSectionId = await makeSection(schoolId);
    const { studentId, token: studentToken } = await makeStudentUser(schoolId, slug, sectionId, "Denied Pupil");
    const { token: parentToken } = await makeLogin(schoolId, slug, "PARENT", "parent", "Denied Parent");
    const outsiderTeacher = await makeTeacher(schoolId, slug, otherSectionId);
    const exam = await makeExam(schoolId, adminToken);
    await enterMark(schoolId, exam.examSubjectId, studentId, 60);
    setGroqClient(stubGroqClient("Never used."));

    const url = `/api/v1/schools/${schoolId}/exams/${exam.examId}/remarks/generate`;
    // Pupils/parents don't hold exams.manage at all.
    await request(app).post(url).set("Authorization", `Bearer ${studentToken}`).send({ studentId }).expect(403);
    await request(app).post(url).set("Authorization", `Bearer ${parentToken}`).send({ studentId }).expect(403);
    // A teacher of ANOTHER section holds the key but not the relationship.
    const denied = await request(app)
      .post(url)
      .set("Authorization", `Bearer ${outsiderTeacher}`)
      .send({ studentId })
      .expect(403);
    expect(denied.body.error.code).toBe("NOT_SECTION_TEACHER");

    // Stranger-school admin: tenant middleware rejects before the exam lookup.
    const other = await registerSchool();
    await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/remarks/generate`)
      .set("Authorization", `Bearer ${other.adminToken}`)
      .send({ studentId })
      .expect(403);
  });

  it("404s unknown exams/students and 400s bad bodies", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const { studentId } = await makeStudentUser(schoolId, slug, sectionId, "Edge Case");
    const exam = await makeExam(schoolId, adminToken);
    setGroqClient(stubGroqClient("Never used."));
    const auth = { Authorization: `Bearer ${adminToken}` };

    await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/does-not-exist/remarks/generate`)
      .set(auth)
      .send({ studentId })
      .expect(404);
    const noExam = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/does-not-exist/remarks/generate`)
      .set(auth)
      .send({ studentId });
    expect(noExam.body.error.code).toBe("EXAM_NOT_FOUND");

    const noStudent = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/remarks/generate`)
      .set(auth)
      .send({ studentId: "no-such-student" });
    expect(noStudent.status).toBe(404);

    await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/remarks/generate`)
      .set(auth)
      .send({})
      .expect(400);
  });

  it("fails 503 AI_UNCONFIGURED with no key and no stub (fail-closed, never a fake remark)", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const { studentId } = await makeStudentUser(schoolId, slug, sectionId, "Unconfigured Pupil");
    const exam = await makeExam(schoolId, adminToken);
    delete process.env.GROQ_API_KEY;
    setGroqClient(null);

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams/${exam.examId}/remarks/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ studentId })
      .expect(503);
    expect(res.body.error.code).toBe("AI_UNCONFIGURED");
    expect(await prisma.examRemark.count({ where: { schoolId } })).toBe(0);
  });
});

