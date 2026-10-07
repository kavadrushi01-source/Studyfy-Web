import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
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
  // PDFKit deflates content streams AND splits rendered text into
  // hex chunks with kerning adjustments, so visible words never appear
  // literally in the raw bytes. Inflate every stream, hex-decode the text
  // show-ops, and join — what remains reads like the printed card.
  function pdfText(pdf: Buffer): string {
    const raw = pdf.toString("latin1");
    const inflated: string[] = [];
    let from = 0;
    for (;;) {
      const start = raw.indexOf("stream", from);
      if (start === -1) {
        break;
      }
      const end = raw.indexOf("endstream", start);
      if (end === -1) {
        break;
      }
      let chunk = raw.slice(start + "stream".length, end);
      chunk = chunk.replace(/^\r\n/, "").replace(/^\n/, "").replace(/\r\n$/, "").replace(/\n$/, "");
      try {
        inflated.push(inflateSync(Buffer.from(chunk, "latin1")).toString("latin1"));
      } catch {
        inflated.push(chunk);
      }
      from = end + "endstream".length;
    }
    const content = inflated.join("\n");
    const words: string[] = [];
    const hexRe = /<([0-9a-fA-F]+)>/g;
    let m: RegExpExecArray | null;
    while ((m = hexRe.exec(content)) !== null) {
      const hex = m[1] ?? "";
      if (hex.length >= 2 && hex.length % 2 === 0) {
        words.push(Buffer.from(hex, "hex").toString("latin1"));
      }
    }
    return words.join("");
  }

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
      remark: null,
    });
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf.length).toBeGreaterThan(1024);
  });

  it("prints the saved remark when present, and no remark section otherwise", async () => {
    const base = {
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
      attendancePercent: null as number | null,
      attendanceRange: null as string | null,
    };
    const withRemark = await generateReportCard({
      ...base,
      remark: { text: "Steady progress this term, keep it up.", generatedBy: "TEACHER" },
    });
    const withText = pdfText(withRemark);
    expect(withText).toContain("Class Teacher's Remark");
    expect(withText).toContain("Steady progress this term, keep it up.");

    const withoutRemark = await generateReportCard({ ...base, remark: null });
    expect(pdfText(withoutRemark)).not.toContain("Class Teacher's Remark");
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

  it("pulls the saved REVIEWED remark into the PDF; unreviewed drafts stay off the card", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const owner = await makeStudent(schoolId, sectionId);

    const math = await prisma.subject.create({ data: { schoolId, name: `Mathematics ${uid()}`, group: "Core" } });
    const exam = await request(app)
      .post(`/api/v1/schools/${schoolId}/exams`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Remark Term 1", subjects: [{ subjectId: math.id, maxMarks: 50 }] })
      .expect(201);
    const examId = exam.body.data.exam.id as string;

    // Unreviewed AI draft only: the card carries no remark section.
    await prisma.examRemark.create({
      data: { schoolId, studentId: owner.studentId, examId, remark: "Unsigned draft text", generatedBy: "AI" },
    });
    const before = await request(app)
      .get(`/api/v1/schools/${schoolId}/exams/${examId}/report-cards/${owner.studentId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const beforeBytes = before.body as Buffer;
    expect(beforeBytes.subarray(0, 5).toString()).toBe("%PDF-");
    const beforeText = pdfText(beforeBytes);
    expect(beforeText).not.toContain("Unsigned draft text");
    expect(beforeText).not.toContain("Class Teacher's Remark");

    // Reviewed row saved: the card pulls it — no Groq call involved.
    await prisma.examRemark.create({
      data: {
        schoolId,
        studentId: owner.studentId,
        examId,
        remark: "Signed term remark for the card",
        generatedBy: "TEACHER",
        reviewed: true,
      },
    });
    const after = await request(app)
      .get(`/api/v1/schools/${schoolId}/exams/${examId}/report-cards/${owner.studentId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const afterText = pdfText(after.body as Buffer);
    expect(afterText).toContain("Class Teacher's Remark");
    expect(afterText).toContain("Signed term remark for the card");
    expect(afterText).not.toContain("Unsigned draft text");
  });
});
