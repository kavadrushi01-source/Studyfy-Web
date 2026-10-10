import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { setMailer, stubMailer, type NoticeEmail } from "../src/lib/mailer.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

const emailed: NoticeEmail[] = [];

beforeAll(() => {
  setMailer({
    ...stubMailer,
    sendNoticeEmail: async (email: NoticeEmail) => {
      emailed.push(email);
      return "sent";
    },
  });
});

afterAll(() => {
  setMailer(null);
});

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Notice School ${uid()}`,
      adminName: "Notice Admin",
      adminEmail: `notice-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function loginAs(
  schoolId: string,
  slug: string,
  roleName: string,
  password = "user-pass-123",
): Promise<{ token: string; userId: string; email: string }> {
  const email = `notice-${roleName.toLowerCase()}-${uid()}@example.com`;
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

async function loginStudentInSection(
  schoolId: string,
  slug: string,
  sectionId: string,
): Promise<{ token: string; studentId: string }> {
  const email = `notice-pupil-${uid()}@example.com`;
  const password = "pupil-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Notice Pupil" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, studentId: student.id };
}

async function makeClassroom(
  schoolId: string,
  parentEmails: string[],
): Promise<{ classId: string; sectionId: string; studentIds: string[] }> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const studentRole = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  const parentRole = await prisma.role.findUnique({ where: { name: "PARENT" } });
  if (!studentRole || !parentRole) {
    throw new Error("Roles must be seeded");
  }
  const studentIds: string[] = [];
  for (const parentEmail of parentEmails) {
    const studentUser = await prisma.user.create({
      data: {
        schoolId,
        roleId: studentRole.id,
        email: `notice-student-${uid()}@example.com`,
        passwordHash: "x",
        name: "Notice Student",
      },
    });
    const student = await prisma.student.create({ data: { schoolId, userId: studentUser.id, sectionId: section.id } });
    const parent = await prisma.user.create({
      data: { schoolId, roleId: parentRole.id, email: parentEmail, passwordHash: "x", name: "Notice Parent" },
    });
    await prisma.studentGuardian.create({
      data: { schoolId, studentId: student.id, parentId: parent.id, relationship: "Father" },
    });
    studentIds.push(student.id);
  }
  return { classId: cls.id, sectionId: section.id, studentIds };
}

describe("notices board + delivery (§7 Phase 1 #7)", () => {
  it("publishes school-wide and emails every parent and staffer", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const parentA = `nparent-a-${uid()}@example.com`;
    const parentB = `nparent-b-${uid()}@example.com`;
    await makeClassroom(schoolId, [parentA]);
    await makeClassroom(schoolId, [parentB]);
    emailed.length = 0;

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/notices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "PT Meeting Saturday", body: "All parents are requested to attend the PT meeting on Saturday at 10 AM." })
      .expect(201);

    expect(typeof res.body.data.id).toBe("string");
    const recipients = emailed.map((e) => e.to).sort();
    // Both class parents + the admin author (staff). No teachers exist here.
    expect(recipients).toContain(parentA);
    expect(recipients).toContain(parentB);
    expect(emailed[0]?.title).toBe("PT Meeting Saturday");
  });

  it("scopes class notices to that class's parents (+ teachers), nobody else's", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const parentA = `cparent-a-${uid()}@example.com`;
    const parentB = `cparent-b-${uid()}@example.com`;
    const classA = await makeClassroom(schoolId, [parentA]);
    await makeClassroom(schoolId, [parentB]);
    const teacher = await loginAs(schoolId, slug, "TEACHER");
    emailed.length = 0;

    await request(app)
      .post(`/api/v1/schools/${schoolId}/notices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        title: "Grade trip permission slips",
        body: "Please sign and return the trip permission slips by Friday for Grade students.",
        target: "CLASS",
        classId: classA.classId,
      })
      .expect(201);

    const recipients = emailed.map((e) => e.to);
    expect(recipients).toContain(parentA);
    expect(recipients).toContain(teacher.email);
    expect(recipients).not.toContain(parentB);
  });

  it("lets teachers publish, blocks students, validates scope ids", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    void adminToken;
    const teacher = await loginAs(schoolId, slug, "TEACHER");
    const student = await loginAs(schoolId, slug, "STUDENT");

    await request(app)
      .post(`/api/v1/schools/${schoolId}/notices`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ title: "Homework deadline moved", body: "Friday's homework deadline moves to Monday morning." })
      .expect(201);

    const denied = await request(app)
      .post(`/api/v1/schools/${schoolId}/notices`)
      .set("Authorization", `Bearer ${student.token}`)
      .send({ title: "Student party", body: "Students throw a party in the hall tonight." })
      .expect(403);
    expect(denied.body.error.code).toBe("PERMISSION_DENIED");

    const missingClass = await request(app)
      .post(`/api/v1/schools/${schoolId}/notices`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ title: "No class given here", body: "This class notice names no class at all.", target: "CLASS" })
      .expect(400);
    expect(missingClass.body.error.code).toBe("VALIDATION_ERROR");

    const foreign = await request(app)
      .post(`/api/v1/schools/${schoolId}/notices`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({
        title: "Foreign class notice",
        body: "This targets a class from another school entirely.",
        target: "CLASS",
        classId: "cmu00000000000000000000000",
      })
      .expect(404);
    expect(foreign.body.error.code).toBe("CLASS_NOT_FOUND");
  });

  it("shows students only school-wide + own class, and blocks cross-tenant posting", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const classA = await makeClassroom(schoolA.schoolId, [`vparent-${uid()}@example.com`]);
    await makeClassroom(schoolB.schoolId, [`wparent-${uid()}@example.com`]);
    const pupil = await loginStudentInSection(schoolA.schoolId, schoolA.slug, classA.sectionId);

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/notices`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ title: "School-wide assembly", body: "Whole-school assembly on Monday morning in the hall." })
      .expect(201);
    await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/notices`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .send({ title: "Other school assembly", body: "A different school's own assembly notice." })
      .expect(201);

    // Pupil sits in classA: sees school-wide + (no class notices here), never B.
    const list = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/notices`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(200);
    const titles = (list.body.data.notices as { title: string }[]).map((n) => n.title);
    expect(titles).toContain("School-wide assembly");
    expect(titles).not.toContain("Other school assembly");

    // Cross-tenant POST: A's URL with B's token.
    const cross = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/notices`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .send({ title: "Intruder notice", body: "School B admin posting into school A." })
      .expect(403);
    expect(cross.body.error.code).toBe("TENANT_MISMATCH");
  });
});
