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
      schoolName: `Results School ${uid()}`,
      adminName: "Results Admin",
      adminEmail: `results-admin-${uid()}@example.com`,
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
  const email = `results-student-${uid()}@example.com`;
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Results Student" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, schoolSlug: (await prisma.school.findUnique({ where: { id: schoolId } }))?.slug })
    .expect(200);
  return { token: login.body.data.accessToken as string, studentId: student.id };
}

// Exam with ONE subject (max 100): totals are just the entered marks,
// so rank math is exactly checkable: 95/85/85/70 -> ranks 1,2,2,4.
async function makeRankedExam(
  schoolId: string,
  adminToken: string,
  sectionId: string,
  scores: number[],
): Promise<{ examId: string; studentIds: string[] }> {
  const math = await prisma.subject.create({ data: { schoolId, name: `Mathematics ${uid()}`, group: "Core" } });
  const exam = await request(app)
    .post(`/api/v1/schools/${schoolId}/exams`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Rank Test", subjects: [{ subjectId: math.id, maxMarks: 100 }] })
    .expect(201);
  const examSubjectId = exam.body.data.exam.examSubjects[0].id as string;
  const studentIds: string[] = [];
  for (const score of scores) {
    const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
    const user = await prisma.user.create({
      data: {
        schoolId,
        roleId: role?.id ?? "",
        email: `ranked-${uid()}@example.com`,
        passwordHash: "x",
        name: "Ranked Student",
      },
    });
    const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
    studentIds.push(student.id);
    await prisma.mark.create({
      data: { schoolId, examSubjectId, studentId: student.id, marksObtained: score },
    });
  }
  return { examId: exam.body.data.exam.id as string, studentIds };
}

describe("GET /api/v1/schools/:schoolId/exams/:examId/results (§11)", () => {
  it("returns rounded percents, grades, and competition ranks", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const { examId, studentIds } = await makeRankedExam(schoolId, adminToken, sectionId, [95, 85, 85, 70]);

    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/exams/${examId}/results`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const results = res.body.data.results as {
      studentId: string;
      percent: number;
      grade: string;
      rank: number;
    }[];
    expect(results).toHaveLength(4);
    const byId = new Map(results.map((r) => [r.studentId, r]));
    expect(byId.get(studentIds[0] ?? "")).toMatchObject({ percent: 95, grade: "A+", rank: 1 });
    expect(byId.get(studentIds[1] ?? "")).toMatchObject({ percent: 85, grade: "B+", rank: 2 });
    expect(byId.get(studentIds[2] ?? "")).toMatchObject({ percent: 85, grade: "B+", rank: 2 });
    expect(byId.get(studentIds[3] ?? "")).toMatchObject({ percent: 70, grade: "C", rank: 4 });
  });

  it("top=K takes the heap path but keeps true full-set ranks", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const { examId } = await makeRankedExam(schoolId, adminToken, sectionId, [95, 85, 85, 70]);

    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/exams/${examId}/results?top=2`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const results = res.body.data.results as { rank: number; percent: number }[];
    // Tie at the cutoff (85,85) is included fairly: 3 rows, ranks 1,2,2.
    expect(results.map((r) => r.rank)).toEqual([1, 2, 2]);
    expect(results.map((r) => r.percent)).toEqual([95, 85, 85]);
  });

  it("pins students to their own row and 404s foreign exams", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const sectionId = await makeSection(schoolA.schoolId);
    const pupil = await makeStudent(schoolA.schoolId, sectionId);
    const outsider = await makeStudent(schoolA.schoolId, sectionId);
    const { examId } = await makeRankedExam(schoolA.schoolId, schoolA.adminToken, sectionId, [90, 80]);
    // The pupil sits the exam too — unmarked students don't rank, by design.
    const subject = await prisma.examSubject.findFirst({ where: { examId } });
    await prisma.mark.create({
      data: { schoolId: schoolA.schoolId, examSubjectId: subject?.id ?? "", studentId: pupil.studentId, marksObtained: 88 },
    });

    const own = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/exams/${examId}/results`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(200);
    expect((own.body.data.results as { studentId: string }[]).map((r) => r.studentId)).toEqual([pupil.studentId]);

    const other = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/exams/${examId}/results?studentId=${outsider.studentId}`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(403);
    expect(other.body.error.code).toBe("FORBIDDEN");

    const foreign = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/exams/${examId}/results`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(404);
    expect(foreign.body.error.code).toBe("EXAM_NOT_FOUND");
  });
});
