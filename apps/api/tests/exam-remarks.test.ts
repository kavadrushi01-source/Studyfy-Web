import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { TENANT_MODELS, scopedPrismaClient } from "../src/lib/prisma-tenant.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(name: string): Promise<string> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: name,
      adminName: "Remark Admin",
      adminEmail: `remark-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return res.body.data.school.id as string;
}

async function createStudent(schoolId: string, sectionName: string): Promise<string> {
  const studentRole = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!studentRole) {
    throw new Error("STUDENT role must be seeded");
  }
  let section = await prisma.section.findFirst({ where: { schoolId, name: sectionName } });
  if (!section) {
    const cls = await prisma.class.create({ data: { schoolId, name: `Class ${sectionName}` } });
    section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: sectionName } });
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: studentRole.id,
      email: `remark-student-${uid()}@example.com`,
      passwordHash: "not-a-real-login",
      name: "Remark Student",
    },
  });
  const student = await prisma.student.create({
    data: { schoolId, userId: user.id, sectionId: section.id },
  });
  return student.id;
}

async function createExam(schoolId: string): Promise<string> {
  const exam = await prisma.exam.create({ data: { schoolId, name: `Remark Exam ${uid()}` } });
  return exam.id;
}

describe("exam_remarks tenant scoping (§7 Phase 3 #18, RULES.md §3)", () => {
  it("lists ExamRemark in TENANT_MODELS (the v1 failure mode was exactly this entry missing)", () => {
    expect((TENANT_MODELS as readonly string[])).toContain("ExamRemark");
  });

  it("scoped reads return only the request school's remarks — both directions", async () => {
    const schoolA = await registerSchool(`Remark School A ${uid()}`);
    const schoolB = await registerSchool(`Remark School B ${uid()}`);
    const studentA = await createStudent(schoolA, "RA1");
    const studentB = await createStudent(schoolB, "RB1");
    const examA = await createExam(schoolA);
    const examB = await createExam(schoolB);
    await prisma.examRemark.create({
      data: { schoolId: schoolA, studentId: studentA, examId: examA, remark: "A remark", generatedBy: "AI", reviewed: true },
    });
    await prisma.examRemark.create({
      data: { schoolId: schoolB, studentId: studentB, examId: examB, remark: "B remark", generatedBy: "TEACHER" },
    });

    const seenByA = await scopedPrismaClient(prisma, schoolA).examRemark.findMany();
    const seenByB = await scopedPrismaClient(prisma, schoolB).examRemark.findMany();

    expect(seenByA.map((r) => r.remark)).toEqual(["A remark"]);
    expect(seenByB.map((r) => r.remark)).toEqual(["B remark"]);
  });

  it("cross-tenant findFirst by id returns null (rejection, not just happy-path filtering)", async () => {
    const schoolA = await registerSchool(`Remark School A2 ${uid()}`);
    const schoolB = await registerSchool(`Remark School B2 ${uid()}`);
    const studentB = await createStudent(schoolB, "RB2");
    const examB = await createExam(schoolB);
    const rowB = await prisma.examRemark.create({
      data: { schoolId: schoolB, studentId: studentB, examId: examB, remark: "B2 remark", generatedBy: "TEACHER" },
    });

    const leaked = await scopedPrismaClient(prisma, schoolA).examRemark.findFirst({ where: { id: rowB.id } });
    expect(leaked).toBeNull();
  });

  it("scoped creates are force-stamped with the request school (a handler cannot file under another school)", async () => {
    const schoolA = await registerSchool(`Remark School A3 ${uid()}`);
    const schoolB = await registerSchool(`Remark School B3 ${uid()}`);
    const studentA = await createStudent(schoolA, "RA3");
    const examA = await createExam(schoolA);

    const row = await scopedPrismaClient(prisma, schoolA).examRemark.create({
      data: { schoolId: schoolB, studentId: studentA, examId: examA, remark: "Stamped remark" },
    });
    expect(row.schoolId).toBe(schoolA);
  });

  it("defaults to TEACHER + unreviewed; AI + reviewed round-trips", async () => {
    const school = await registerSchool(`Remark School C ${uid()}`);
    const student = await createStudent(school, "RC1");
    const exam = await createExam(school);

    const def = await prisma.examRemark.create({
      data: { schoolId: school, studentId: student, examId: exam, remark: "Teacher words" },
    });
    expect(def.generatedBy).toBe("TEACHER");
    expect(def.reviewed).toBe(false);

    const ai = await prisma.examRemark.create({
      data: { schoolId: school, studentId: student, examId: exam, remark: "AI draft", generatedBy: "AI", reviewed: true },
    });
    const reread = await prisma.examRemark.findUnique({ where: { id: ai.id } });
    expect(reread?.generatedBy).toBe("AI");
    expect(reread?.reviewed).toBe(true);
  });
});
