import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { setDocumentStorage, stubDocumentStorage } from "../src/lib/storage.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

const uploads: { folder: string }[] = [];

beforeAll(() => {
  setDocumentStorage({
    ...stubDocumentStorage(),
    upload: async (input) => {
      const folder = `schools/${input.schoolId}/documents`;
      uploads.push({ folder });
      return { url: `https://cdn.example/${folder}/fake-${uid()}.pdf`, publicId: `fake-${uid()}` };
    },
  });
});

afterAll(() => {
  setDocumentStorage(null);
});

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Submit School ${uid()}`,
      adminName: "Submit Admin",
      adminEmail: `submit-admin-${uid()}@example.com`,
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
  const email = `submit-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  if (!role) {
    throw new Error("TEACHER role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Submit Teacher" },
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
  const email = `submit-student-${uid()}@example.com`;
  const password = "student-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Submit Student" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, studentId: student.id };
}

async function postHomework(
  schoolId: string,
  adminToken: string,
  sectionId: string,
  subjectId: string,
): Promise<string> {
  // Admin posting needs at least one qualified teacher in school (the row
  // always gets an owner) — qualify a throwaway teacher first.
  const teacherRole = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  const qualUser = await prisma.user.create({
    data: {
      schoolId,
      roleId: teacherRole?.id ?? "",
      email: `hw-qual-${uid()}@example.com`,
      passwordHash: "x",
      name: "HW Qualifier",
    },
  });
  const qualStaff = await prisma.staff.create({ data: { schoolId, userId: qualUser.id, designation: "Teacher" } });
  await prisma.teacherSubject.create({ data: { schoolId, staffId: qualStaff.id, subjectId } });
  const res = await request(app)
    .post(`/api/v1/schools/${schoolId}/homework`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      sectionId,
      subjectId,
      title: "Worksheet 1",
      description: "Solve everything before Friday, please.",
      dueDate: "2026-10-10",
    })
    .expect(201);
  return res.body.data.homework.id as string;
}

describe("homework submissions + grading (§7 Phase 1 #6)", () => {
  it("accepts text, then a file under the school folder, overwriting on re-submit", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const math = await makeSubject(schoolId);
    const pupil = await makeStudent(schoolId, slug, sectionId);
    const homeworkId = await postHomework(schoolId, adminToken, sectionId, math);

    const text = await request(app)
      .post(`/api/v1/schools/${schoolId}/homework/${homeworkId}/submissions`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .field("content", "My algebra answers.")
      .expect(201);
    expect(text.body.data.submission.status).toBe("SUBMITTED");

    const file = await request(app)
      .post(`/api/v1/schools/${schoolId}/homework/${homeworkId}/submissions`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .field("content", "Revised answers with scans.")
      .attach("file", Buffer.from("%PDF-1.4 scan"), { filename: "scan.pdf", contentType: "application/pdf" })
      .expect(201);
    expect(file.body.data.submission.fileUrl).toContain(`schools/${schoolId}/documents`);
    const last = uploads[uploads.length - 1];
    expect(last?.folder).toBe(`schools/${schoolId}/documents`);

    const count = await prisma.homeworkSubmission.count({ where: { schoolId, homeworkId } });
    expect(count).toBe(1);
  });

  it("blocks other sections, bad files, and keyless roles", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId);
    const sectionB = await makeSection(schoolId);
    const math = await makeSubject(schoolId);
    const pupilA = await makeStudent(schoolId, slug, sectionA);
    const homeworkB = await postHomework(schoolId, adminToken, sectionB, math);

    const foreign = await request(app)
      .post(`/api/v1/schools/${schoolId}/homework/${homeworkB}/submissions`)
      .set("Authorization", `Bearer ${pupilA.token}`)
      .field("content", "Not my section.")
      .expect(403);
    expect(foreign.body.error.code).toBe("NOT_YOUR_HOMEWORK");

    const homeworkA = await postHomework(schoolId, adminToken, sectionA, math);
    const exe = await request(app)
      .post(`/api/v1/schools/${schoolId}/homework/${homeworkA}/submissions`)
      .set("Authorization", `Bearer ${pupilA.token}`)
      .attach("file", Buffer.from("MZ"), { filename: "evil.exe", contentType: "application/octet-stream" })
      .expect(415);
    expect(exe.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");

    const empty = await request(app)
      .post(`/api/v1/schools/${schoolId}/homework/${homeworkA}/submissions`)
      .set("Authorization", `Bearer ${pupilA.token}`)
      .field("content", "")
      .expect(400);
    expect(empty.body.error.code).toBe("VALIDATION_ERROR");

    await request(app)
      .post(`/api/v1/schools/${schoolId}/homework/${homeworkA}/submissions`)
      .field("content", "No token.")
      .expect(401);
  });

  it("lets the subject teacher grade, blocks outsiders", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const math = await makeSubject(schoolId);
    const art = await makeSubject(schoolId);
    const teacher = await makeTeacher(schoolId, slug, [math], sectionId);
    const stranger = await makeTeacher(schoolId, slug, [art], null);
    const pupil = await makeStudent(schoolId, slug, sectionId);
    const homeworkId = await postHomework(schoolId, adminToken, sectionId, math);

    const sub = await request(app)
      .post(`/api/v1/schools/${schoolId}/homework/${homeworkId}/submissions`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .field("content", "Grade me.")
      .expect(201);
    const submissionId = sub.body.data.submission.id as string;

    const graded = await request(app)
      .post(`/api/v1/schools/${schoolId}/submissions/${submissionId}/grade`)
      .set("Authorization", `Bearer ${teacher}`)
      .expect(200);
    expect(graded.body.data.submission.status).toBe("GRADED");

    const denied = await request(app)
      .post(`/api/v1/schools/${schoolId}/submissions/${submissionId}/grade`)
      .set("Authorization", `Bearer ${stranger}`)
      .expect(403);
    expect(denied.body.error.code).toBe("NOT_SUBJECT_TEACHER");

    const missing = await request(app)
      .post(`/api/v1/schools/${schoolId}/submissions/cmu00000000000000000000000/grade`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);
    expect(missing.body.error.code).toBe("SUBMISSION_NOT_FOUND");
  });
});
