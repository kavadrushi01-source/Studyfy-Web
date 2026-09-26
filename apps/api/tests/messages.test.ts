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
      schoolName: `Chat School ${uid()}`,
      adminName: "Chat Admin",
      adminEmail: `chat-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSection(schoolId: string, name: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name } });
  return section.id;
}

async function makeSubject(schoolId: string): Promise<string> {
  const subject = await prisma.subject.create({ data: { schoolId, name: `Subject ${uid()}`, group: "Core" } });
  return subject.id;
}

async function makeUser(
  schoolId: string,
  slug: string,
  roleName: string,
  password = "user-pass-123",
): Promise<{ token: string; userId: string; email: string }> {
  const email = `chat-${roleName.toLowerCase()}-${uid()}@example.com`;
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`${roleName} role must be seeded`);
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} User` },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id, email };
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
): Promise<{ token: string; userId: string; studentId: string }> {
  const student = await makeUser(schoolId, slug, "STUDENT");
  const profile = await prisma.student.create({ data: { schoolId, userId: student.userId, sectionId } });
  return { token: student.token, userId: student.userId, studentId: profile.id };
}

async function makeParent(
  schoolId: string,
  slug: string,
  linkedStudentId: string,
): Promise<{ token: string; userId: string }> {
  const parent = await makeUser(schoolId, slug, "PARENT");
  await prisma.studentGuardian.create({
    data: { schoolId, studentId: linkedStudentId, parentId: parent.userId, relationship: "Father" },
  });
  return parent;
}

describe("1:1 academic messaging (§13.7)", () => {
  it("blocks a teacher who does not teach the student (the §13.7 core case)", async () => {
    const { schoolId, slug } = await registerSchool();
    const sectionId = await makeSection(schoolId, "A");
    const math = await makeSubject(schoolId);
    const pupil = await makeStudent(schoolId, slug, sectionId);
    // Qualified in math, but class teacher of NOTHING and scheduled NOWHERE.
    const stranger = await makeTeacher(schoolId, slug, [math], null);

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${stranger.token}`)
      .send({ receiverId: pupil.userId, body: "Hello from a stranger." })
      .expect(403);
    expect(res.body.error.code).toBe("MESSAGING_NOT_ALLOWED");

    // And the reverse: the pupil cannot reach that stranger either.
    const reverse = await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .send({ receiverId: stranger.userId, body: "Hi?" })
      .expect(403);
    expect(reverse.body.error.code).toBe("MESSAGING_NOT_ALLOWED");
  });

  it("lets linked teacher↔student and teacher↔parent talk, both directions", async () => {
    const { schoolId, slug } = await registerSchool();
    const sectionId = await makeSection(schoolId, "A");
    const math = await makeSubject(schoolId);
    const teacher = await makeTeacher(schoolId, slug, [math], sectionId);
    const pupil = await makeStudent(schoolId, slug, sectionId);
    const parent = await makeParent(schoolId, slug, pupil.studentId);

    const t2s = await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ receiverId: pupil.userId, body: "Please revise chapter 3." })
      .expect(201);
    expect(t2s.body.data.message.body).toBe("Please revise chapter 3.");

    const s2t = await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .send({ receiverId: teacher.userId, body: "Done, sir." })
      .expect(201);
    expect(s2t.body.data.message.threadId).toBe(t2s.body.data.message.threadId);

    const thread = await request(app)
      .get(`/api/v1/schools/${schoolId}/messages?with=${teacher.userId}`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(200);
    expect((thread.body.data.messages as { body: string }[]).map((m) => m.body)).toEqual([
      "Please revise chapter 3.",
      "Done, sir.",
    ]);

    const p2t = await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${parent.token}`)
      .send({ receiverId: teacher.userId, body: "How is my child doing?" })
      .expect(201);
    expect(p2t.body.data.message.threadId).not.toBe(t2s.body.data.message.threadId);
  });

  it("forbids student-student chat, parent→stranger-teacher, admin-sends, and strangers", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId, "A");
    const math = await makeSubject(schoolId);
    const pupilA = await makeStudent(schoolId, slug, sectionId);
    const pupilB = await makeStudent(schoolId, slug, sectionId);
    const linked = await makeTeacher(schoolId, slug, [math], sectionId);
    const parent = await makeParent(schoolId, slug, pupilA.studentId);

    // No open student-to-student messaging. Ever.
    const s2s = await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${pupilA.token}`)
      .send({ receiverId: pupilB.userId, body: "Hey!" })
      .expect(403);
    expect(s2s.body.error.code).toBe("MESSAGING_NOT_ALLOWED");

    // Parent to a teacher with no link to their child.
    const otherTeacher = await makeTeacher(schoolId, slug, [math], null);
    const p2t = await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${parent.token}`)
      .send({ receiverId: otherTeacher.userId, body: "Hello?" })
      .expect(403);
    expect(p2t.body.error.code).toBe("MESSAGING_NOT_ALLOWED");

    // Admin holds no messages.send: oversight reads, never participates.
    const adminSends = await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ receiverId: pupilA.userId, body: "Admin here." })
      .expect(403);
    expect(adminSends.body.error.code).toBe("PERMISSION_DENIED");

    // But the admin CAN read any thread (oversight).
    await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${linked.token}`)
      .send({ receiverId: pupilA.userId, body: "Reminder: test Friday." })
      .expect(201);
    const oversight = await request(app)
      .get(`/api/v1/schools/${schoolId}/messages?with=${pupilA.userId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect((oversight.body.data.messages as { body: string }[]).length).toBeGreaterThan(0);

    // Validation + auth still apply.
    await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${linked.token}`)
      .send({ receiverId: pupilA.userId, body: "" })
      .expect(400);
    await request(app).post(`/api/v1/schools/${schoolId}/messages`).send({ receiverId: pupilA.userId, body: "x" }).expect(401);

    // Cross-tenant: A's URL with B's token.
    const schoolB = await registerSchool();
    const cross = await request(app)
      .post(`/api/v1/schools/${schoolId}/messages`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .send({ receiverId: pupilA.userId, body: "Intruder." })
      .expect(403);
    expect(cross.body.error.code).toBe("TENANT_MISMATCH");
  });
});

describe("GET /api/v1/schools/:schoolId/messages/contacts (new-message picker)", () => {
  it("offers teachers only linked pupils+parents, pupils only linked teachers", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    void adminToken;
    const sectionId = await makeSection(schoolId, "A");
    const math = await makeSubject(schoolId);
    const teacher = await makeTeacher(schoolId, slug, [math], sectionId);
    const stranger = await makeTeacher(schoolId, slug, [math], null);
    const pupil = await makeStudent(schoolId, slug, sectionId);
    const parent = await makeParent(schoolId, slug, pupil.studentId);

    const teacherContacts = await request(app)
      .get(`/api/v1/schools/${schoolId}/messages/contacts`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(200);
    const teacherIds = (teacherContacts.body.data.contacts as { userId: string }[]).map((c) => c.userId);
    expect(teacherIds).toContain(pupil.userId);
    expect(teacherIds).toContain(parent.userId);
    expect(teacherIds).not.toContain(stranger.userId);
    expect(teacherIds).not.toContain(teacher.userId);

    const pupilContacts = await request(app)
      .get(`/api/v1/schools/${schoolId}/messages/contacts`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(200);
    const pupilIds = (pupilContacts.body.data.contacts as { userId: string }[]).map((c) => c.userId);
    expect(pupilIds).toEqual([teacher.userId]);

    // Every offered recipient must actually accept a send (§13.7 parity —
    // the picker can never offer someone the send path would reject).
    for (const id of teacherIds) {
      await request(app)
        .post(`/api/v1/schools/${schoolId}/messages`)
        .set("Authorization", `Bearer ${teacher.token}`)
        .send({ receiverId: id, body: "Parity check." })
        .expect(201);
    }

    // Admins send nothing: empty picker, not an error.
    const school = await registerSchool();
    const adminContacts = await request(app)
      .get(`/api/v1/schools/${school.schoolId}/messages/contacts`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .expect(200);
    expect(adminContacts.body.data.contacts).toEqual([]);

    await request(app).get(`/api/v1/schools/${schoolId}/messages/contacts`).expect(401);
  }, 30000);
});
