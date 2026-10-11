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
      schoolName: `Review School ${uid()}`,
      adminName: "Review Admin",
      adminEmail: `review-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  // Phase 3 module under test (§16.1): this fixture school buys
  // Premium+Active. Plan-gating itself is proven in billing-gating.test.ts.
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

async function loginAs(
  schoolId: string,
  slug: string,
  role: string,
  tag: string,
): Promise<{ userId: string; token: string }> {
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  if (!roleRow) {
    throw new Error(`${role} role must be seeded`);
  }
  const email = `review-${tag}-${uid()}@example.com`;
  const user = await prisma.user.create({
    data: { schoolId, roleId: roleRow.id, email, passwordHash: await bcrypt.hash("password-123", 4), name: `${tag} user` },
  });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: "password-123", schoolSlug: slug })
    .expect(200);
  return { userId: user.id, token: login.body.data.accessToken as string };
}

async function makeTeacher(schoolId: string, slug: string, classTeacherOf: string | null): Promise<string> {
  const { userId, token } = await loginAs(schoolId, slug, "TEACHER", "teacher");
  const staff = await prisma.staff.create({ data: { schoolId, userId, designation: "Teacher" } });
  if (classTeacherOf) {
    await prisma.section.update({ where: { id: classTeacherOf }, data: { classTeacherId: staff.id } });
  }
  return token;
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
      email: `review-pupil-${uid()}@example.com`,
      passwordHash: "x",
      name: "Review Pupil",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  return student.id;
}

async function makeExam(schoolId: string, adminToken: string): Promise<string> {
  const math = await prisma.subject.create({ data: { schoolId, name: `Mathematics ${uid()}`, group: "Core" } });
  const res = await request(app)
    .post(`/api/v1/schools/${schoolId}/exams`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: `Review Exam ${uid()}`, subjects: [{ subjectId: math.id, maxMarks: 100 }] })
    .expect(201);
  return res.body.data.exam.id as string;
}

async function seedDraft(schoolId: string, studentId: string, examId: string, remark = "AI draft text"): Promise<string> {
  const row = await prisma.examRemark.create({
    data: { schoolId, studentId, examId, remark, generatedBy: "AI" },
  });
  return row.id;
}

describe("GET + PATCH remarks (§7 Phase 3 #18 — teacher review)", () => {
  it("class teacher reads the draft queue, edits the text, and marks it reviewed", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const studentId = await makeStudent(schoolId, sectionId);
    const teacherToken = await makeTeacher(schoolId, slug, sectionId);
    const examId = await makeExam(schoolId, adminToken);
    const draftId = await seedDraft(schoolId, studentId, examId);

    const list = await request(app)
      .get(`/api/v1/schools/${schoolId}/exams/${examId}/remarks?studentId=${studentId}`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);
    expect(list.body.data.remarks).toHaveLength(1);
    expect(list.body.data.remarks[0]).toMatchObject({ id: draftId, generatedBy: "AI", reviewed: false });

    const patched = await request(app)
      .patch(`/api/v1/schools/${schoolId}/exams/${examId}/remarks/${draftId}`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ remark: "Edited by the class teacher.", reviewed: true })
      .expect(200);
    expect(patched.body.data.remark).toMatchObject({
      id: draftId,
      remark: "Edited by the class teacher.",
      generatedBy: "AI",
      reviewed: true,
    });

    const row = await prisma.examRemark.findUnique({ where: { id: draftId } });
    expect(row?.remark).toBe("Edited by the class teacher.");
    expect(row?.reviewed).toBe(true);
    // Origin is preserved: the row stays an AI draft, now signed off.
    expect(row?.generatedBy).toBe("AI");
  });

  it("admin may flip reviewed alone; pupils, parents, and other-section teachers are refused", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const otherSectionId = await makeSection(schoolId);
    const studentId = await makeStudent(schoolId, sectionId);
    const outsiderTeacher = await makeTeacher(schoolId, slug, otherSectionId);
    const pupil = await loginAs(schoolId, slug, "STUDENT", "pupil");
    const parent = await loginAs(schoolId, slug, "PARENT", "parent");
    const examId = await makeExam(schoolId, adminToken);
    const draftId = await seedDraft(schoolId, studentId, examId);

    const listUrl = `/api/v1/schools/${schoolId}/exams/${examId}/remarks?studentId=${studentId}`;
    const patchUrl = `/api/v1/schools/${schoolId}/exams/${examId}/remarks/${draftId}`;
    await request(app).get(listUrl).set("Authorization", `Bearer ${pupil.token}`).expect(403);
    await request(app).get(listUrl).set("Authorization", `Bearer ${parent.token}`).expect(403);
    await request(app).patch(patchUrl).set("Authorization", `Bearer ${pupil.token}`).send({ reviewed: true }).expect(403);

    const outsiderList = await request(app)
      .get(listUrl)
      .set("Authorization", `Bearer ${outsiderTeacher}`);
    expect(outsiderList.status).toBe(403);
    const outsiderPatch = await request(app)
      .patch(patchUrl)
      .set("Authorization", `Bearer ${outsiderTeacher}`)
      .send({ reviewed: true });
    expect(outsiderPatch.status).toBe(403);
    expect(outsiderPatch.body.error.code).toBe("NOT_SECTION_TEACHER");

    const flipped = await request(app)
      .patch(patchUrl)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reviewed: true })
      .expect(200);
    expect(flipped.body.data.remark.reviewed).toBe(true);
  });

  it("404s rows from another exam or nowhere; 400s empty and overlong bodies", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const studentId = await makeStudent(schoolId, sectionId);
    const examId = await makeExam(schoolId, adminToken);
    const otherExamId = await makeExam(schoolId, adminToken);
    const draftId = await seedDraft(schoolId, studentId, examId);
    const auth = { Authorization: `Bearer ${adminToken}` };
    const patch = (exam: string, row: string) => `/api/v1/schools/${schoolId}/exams/${exam}/remarks/${row}`;

    const crossExam = await request(app).patch(patch(otherExamId, draftId)).set(auth).send({ reviewed: true });
    expect(crossExam.status).toBe(404);
    expect(crossExam.body.error.code).toBe("REMARK_NOT_FOUND");
    await request(app).patch(patch(examId, "no-such-remark")).set(auth).send({ reviewed: true }).expect(404);

    await request(app).patch(patch(examId, draftId)).set(auth).send({}).expect(400);
    await request(app)
      .patch(patch(examId, draftId))
      .set(auth)
      .send({ remark: "x".repeat(2001) })
      .expect(400);
    await request(app)
      .get(`/api/v1/schools/${schoolId}/exams/${examId}/remarks`)
      .set(auth)
      .expect(400);

    // Stranger-school admin never reaches the rows (tenant gate first).
    const other = await registerSchool();
    await request(app)
      .get(`/api/v1/schools/${schoolId}/exams/${examId}/remarks?studentId=${studentId}`)
      .set("Authorization", `Bearer ${other.adminToken}`)
      .expect(403);
  });
});
