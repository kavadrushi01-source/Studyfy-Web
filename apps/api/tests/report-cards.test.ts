import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { generateReportCard } from "../src/lib/report-card.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Report School ${uid()}`,
      adminName: "Report Admin",
      adminEmail: `report-admin-${uid()}@example.com`,
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
  const email = `report-student-${uid()}@example.com`;
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Report Student" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, schoolSlug: (await prisma.school.findUnique({ where: { id: schoolId } }))?.slug })
    .expect(200);
  return { token: login.body.data.accessToken as string, studentId: student.id };
}

describe("student report card PDF (§7 Phase 1 #4)", () => {
  it("renders a complete PDF document", async () => {
    const pdf = await generateReportCard({
      schoolName: "Report School",
      brandColor: "#2563EB",
      examName: "Unit Test 1",
      studentName: "Report Student",
      admissionNo: "R-001",
      className: "Grade 9",
      sectionName: "A",
      subjects: [{ name: "Mathematics", max: 50, obtained: 42, percent: 84, grade: "B" }],
      total: 42,
      max: 50,
      percent: 84,
      grade: "B",
      rank: 2,
      rankedOutOf: 8,
      attendancePercent: 92.5,
      attendanceRange: "2026-09-01 to 2026-09-07",
    });
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf.length).toBeGreaterThan(1024);
  });

  it("serves the card to the owner, blocks others, requires auth", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const owner = await makeStudent(schoolId, sectionId);
    const stranger = await makeStudent(schoolId, sectionId);

    const math = await prisma.subject.create({ data: { schoolId, name: `Mathematics ${uid()}`, group: "Core" } });
    const exam = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Unit Test 1",
        startDate: "2026-09-01",
        endDate: "2026-09-07",
        subjects: [{ subjectId: math.id, maxMarks: 50 }],
      })
      .expect(201);
    const examId = exam.body.data.exam.id as string;
    const examSubjectId = exam.body.data.exam.examSubjects[0].id as string;
    await prisma.mark.create({
      data: { schoolId, examSubjectId, studentId: owner.studentId, marksObtained: 42 },
    });
    const staff = await prisma.staff.findFirst({ where: { schoolId } });
    await prisma.attendance.create({
      data: { schoolId, studentId: owner.studentId, sectionId, date: new Date("2026-09-02T00:00:00Z"), status: "PRESENT", markedById: staff?.id },
    });

    const own = await request(app)
      .get(`/api/v1/schools/${schoolId}/exams/${examId}/report-cards/${owner.studentId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    expect(own.headers["content-type"]).toContain("application/pdf");

    const blocked = await request(app)
      .get(`/api/v1/schools/${schoolId}/exams/${examId}/report-cards/${owner.studentId}`)
      .set("Authorization", `Bearer ${stranger.token}`)
      .expect(403);
    expect(blocked.body.error.code).toBe("FORBIDDEN");

    await request(app)
      .get(`/api/v1/schools/${schoolId}/exams/${examId}/report-cards/${owner.studentId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    await request(app).get(`/api/v1/schools/${schoolId}/exams/${examId}/report-cards/${owner.studentId}`).expect(401);
  });
});
