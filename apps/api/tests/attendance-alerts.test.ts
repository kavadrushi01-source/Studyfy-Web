import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { setMailer, stubMailer, type AbsenteeAlert } from "../src/lib/mailer.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

const sent: AbsenteeAlert[] = [];

beforeAll(() => {
  setMailer({
    ...stubMailer,
    sendAbsenteeAlert: async (alert: AbsenteeAlert) => {
      sent.push(alert);
    },
  });
});

afterAll(() => {
  setMailer(null);
});

async function registerSchool(): Promise<{ schoolId: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Alert School ${uid()}`,
      adminName: "Alert Admin",
      adminEmail: `alert-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return { schoolId: res.body.data.school.id as string, adminToken: res.body.data.accessToken as string };
}

async function makeSection(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  return section.id;
}

async function makeStudent(
  schoolId: string,
  sectionId: string,
  guardianCount: number,
): Promise<{ studentId: string; guardianEmails: string[] }> {
  const studentRole = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  const parentRole = await prisma.role.findUnique({ where: { name: "PARENT" } });
  if (!studentRole || !parentRole) {
    throw new Error("Roles must be seeded");
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: studentRole.id,
      email: `alert-student-${uid()}@example.com`,
      passwordHash: "x",
      name: "Alert Student",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  const guardianEmails: string[] = [];
  for (let i = 0; i < guardianCount; i += 1) {
    const email = `alert-guardian-${uid()}@example.com`;
    const parent = await prisma.user.create({
      data: { schoolId, roleId: parentRole.id, email, passwordHash: "x", name: `Guardian ${i}` },
    });
    await prisma.studentGuardian.create({
      data: { schoolId, studentId: student.id, parentId: parent.id, relationship: i === 0 ? "Father" : "Mother" },
    });
    guardianEmails.push(email);
  }
  return { studentId: student.id, guardianEmails };
}

describe("absentee alerts (§7 Phase 1 #2, Brevo SMTP)", () => {
  it("emails EVERY linked guardian of an absent student, nobody for present ones", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const absent = await makeStudent(schoolId, sectionId, 2);
    const present = await makeStudent(schoolId, sectionId, 1);
    sent.length = 0;

    await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        sectionId,
        date: "2026-09-11",
        records: [
          { studentId: absent.studentId, status: "ABSENT" },
          { studentId: present.studentId, status: "PRESENT" },
        ],
      })
      .expect(200);

    const recipients = sent.map((s) => s.to).sort();
    expect(recipients).toEqual([...absent.guardianEmails].sort());
    expect(sent[0]?.studentName).toBe("Alert Student");
    expect(sent[0]?.date).toBe("2026-09-11");
  });

  it("stays silent when nobody is absent", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const student = await makeStudent(schoolId, sectionId, 1);
    sent.length = 0;

    await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId, date: "2026-09-12", records: [{ studentId: student.studentId, status: "PRESENT" }] })
      .expect(200);

    expect(sent).toHaveLength(0);
  });

  it("still marks when the mailer throws, and when SMTP is unconfigured", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const student = await makeStudent(schoolId, sectionId, 1);

    setMailer({
      ...stubMailer,
      sendAbsenteeAlert: async () => {
        throw new Error("SMTP relay down");
      },
    });
    try {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolId}/attendance`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ sectionId, date: "2026-09-13", records: [{ studentId: student.studentId, status: "ABSENT" }] })
        .expect(200);
      expect(res.body.data.marked).toBe(1);
    } finally {
      setMailer({
        ...stubMailer,
        sendAbsenteeAlert: async (alert: AbsenteeAlert) => {
          sent.push(alert);
        },
      });
    }

    // No stub + no SMTP env (CI/local test envs set none): skipped, not failed.
    setMailer(null);
    try {
      await request(app)
        .post(`/api/v1/schools/${schoolId}/attendance`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ sectionId, date: "2026-09-14", records: [{ studentId: student.studentId, status: "ABSENT" }] })
        .expect(200);
    } finally {
      setMailer({
        ...stubMailer,
        sendAbsenteeAlert: async (alert: AbsenteeAlert) => {
          sent.push(alert);
        },
      });
    }

    const row = await prisma.attendance.findFirst({ where: { schoolId, studentId: student.studentId } });
    expect(row?.status).toBe("ABSENT");
  });
});
