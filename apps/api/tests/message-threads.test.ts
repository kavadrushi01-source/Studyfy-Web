import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { threadKey } from "../src/modules/messages/messages.service.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Thread School ${uid()}`,
      adminName: "Thread Admin",
      adminEmail: `thread-admin-${uid()}@example.com`,
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

async function makeUser(
  schoolId: string,
  slug: string,
  roleName: string,
): Promise<{ token: string; userId: string }> {
  const email = `thread-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "user-pass-123";
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`${roleName} role must be seeded`);
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} User` },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id };
}

async function makeTeacher(
  schoolId: string,
  slug: string,
  subjects: string[],
  classTeacherOf: string | null,
): Promise<{ token: string; userId: string }> {
  const teacher = await makeUser(schoolId, slug, "TEACHER");
  const staff = await prisma.staff.create({ data: { schoolId, userId: teacher.userId, designation: "Teacher" } });
  if (classTeacherOf) {
    await prisma.section.update({ where: { id: classTeacherOf }, data: { classTeacherId: staff.id } });
  }
  for (const subjectId of subjects) {
    await prisma.teacherSubject.create({ data: { schoolId, staffId: staff.id, subjectId } });
  }
  return teacher;
}

async function makeStudent(
  schoolId: string,
  slug: string,
  sectionId: string,
): Promise<{ token: string; userId: string }> {
  const student = await makeUser(schoolId, slug, "STUDENT");
  await prisma.student.create({ data: { schoolId, userId: student.userId, sectionId } });
  return student;
}

interface ThreadRow {
  user: { id: string; name: string };
  lastMessage: { body: string; fromMe: boolean };
  unread: number;
}

describe("GET /api/v1/schools/:schoolId/messages/threads", () => {
  it("lists a participant's own threads with preview + unread, nothing else's", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    void adminToken;
    const sectionId = await makeSection(schoolId);
    const subject = await prisma.subject.create({ data: { schoolId, name: `Subject ${uid()}`, group: "Core" } });
    const teacher = await makeTeacher(schoolId, slug, [subject.id], sectionId);
    const pupilA = await makeStudent(schoolId, slug, sectionId);
    const pupilB = await makeStudent(schoolId, slug, sectionId);

    await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ receiverId: pupilA.userId, body: "Hello A." })
      .expect(201);
    await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ receiverId: pupilB.userId, body: "Hello B." })
      .expect(201);

    const mine = await request(app)
      .get(`/api/v1/schools/${schoolId}/messages/threads`)
      .set("Authorization", `Bearer ${pupilA.token}`)
      .expect(200);
    const rows = mine.body.data.threads as ThreadRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastMessage.body).toBe("Hello A.");
    expect(rows[0]?.lastMessage.fromMe).toBe(false);
    expect(rows[0]?.unread).toBe(1);

    // Teacher sees both threads.
    const teacherRows = await request(app)
      .get(`/api/v1/schools/${schoolId}/messages/threads`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(200);
    expect((teacherRows.body.data.threads as ThreadRow[])).toHaveLength(2);
  });

  it("shows the admin every thread and 401s strangers", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const subject = await prisma.subject.create({ data: { schoolId, name: `Subject ${uid()}`, group: "Core" } });
    const teacher = await makeTeacher(schoolId, slug, [subject.id], sectionId);
    const pupil = await makeStudent(schoolId, slug, sectionId);

    await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ receiverId: pupil.userId, body: "Reminder." })
      .expect(201);

    const admin = await request(app)
      .get(`/api/v1/schools/${schoolId}/messages/threads`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect((admin.body.data.threads as ThreadRow[])).toHaveLength(1);

    const otherSchool = await registerSchool();
    const cross = await request(app)
      .get(`/api/v1/schools/${schoolId}/messages/threads`)
      .set("Authorization", `Bearer ${otherSchool.adminToken}`)
      .expect(403);
    expect(cross.body.error.code).toBe("TENANT_MISMATCH");

    await request(app).get(`/api/v1/schools/${schoolId}/messages/threads`).expect(401);
  });
});

describe("GET thread read past 200 messages (recency first)", () => {
  it("returns the newest 200 in chronological order, never a stale oldest-only window", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const subject = await prisma.subject.create({ data: { schoolId, name: `Subject ${uid()}`, group: "Core" } });
    const teacher = await makeTeacher(schoolId, slug, [subject.id], sectionId);
    const pupil = await makeStudent(schoolId, slug, sectionId);

    // 205 messages, one minute apart - deterministic order, no flakiness.
    const base = Date.UTC(2026, 8, 1, 0, 0, 0);
    const key = threadKey(teacher.userId, pupil.userId);
    await prisma.message.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        id: `msg-${uid()}-${i}`,
        schoolId,
        senderId: i % 2 === 0 ? teacher.userId : pupil.userId,
        receiverId: i % 2 === 0 ? pupil.userId : teacher.userId,
        threadId: key,
        body: `Bulk message ${i}`,
        createdAt: new Date(base + i * 60000),
      })),
    });

    const asTeacher = await request(app)
      .get(`/api/v1/schools/${schoolId}/messages?with=${pupil.userId}`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(200);
    const rows = asTeacher.body.data.messages as { body: string }[];
    expect(rows).toHaveLength(200);
    expect(rows[0]?.body).toBe("Bulk message 5");
    expect(rows[199]?.body).toBe("Bulk message 204");

    // Admin oversight sees the same newest message, not ancient history.
    const asAdmin = await request(app)
      .get(`/api/v1/schools/${schoolId}/messages?with=${pupil.userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const adminRows = asAdmin.body.data.messages as { body: string }[];
    expect(adminRows[adminRows.length - 1]?.body).toBe("Bulk message 204");
  });
});
