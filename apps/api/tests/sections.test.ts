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

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string; adminEmail: string }> {
  const adminEmail = `sections-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Sections School ${uid()}`,
      adminName: "Sections Admin",
      adminEmail,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
    adminEmail,
  };
}

async function makeSection(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  return section.id;
}

async function makeStaff(
  schoolId: string,
  slug: string,
  roleName: string,
): Promise<{ token: string; email: string }> {
  const email = `${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "staff-pass-123";
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`${roleName} role must be seeded`);
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} User` },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: roleName } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, email };
}

describe("sections class-teacher assignment (§9.1)", () => {
  it("lets School Admin assign by email, shows it in the list, and clears on null", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const teacher = await makeStaff(schoolId, slug, "TEACHER");

    const assigned = await request(app)
      .patch(`/api/v1/schools/${schoolId}/sections/${sectionId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ teacherEmail: teacher.email })
      .expect(200);
    expect(assigned.body.data.section.classTeacher.user.email).toBe(teacher.email);

    const list = await request(app)
      .get(`/api/v1/schools/${schoolId}/sections`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const row = (list.body.data.sections as { id: string; classTeacher: { user: { email: string } } | null }[]).find(
      (s) => s.id === sectionId,
    );
    expect(row?.classTeacher?.user.email).toBe(teacher.email);

    const cleared = await request(app)
      .patch(`/api/v1/schools/${schoolId}/sections/${sectionId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ teacherEmail: null })
      .expect(200);
    expect(cleared.body.data.section.classTeacherId).toBeNull();
  });

  it("rejects Teacher and Accountant with 403 (admin-only write)", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    void adminToken;
    const sectionId = await makeSection(schoolId);
    const teacher = await makeStaff(schoolId, slug, "TEACHER");
    const accountant = await makeStaff(schoolId, slug, "ACCOUNTANT");

    for (const token of [teacher.token, accountant.token]) {
      const res = await request(app)
        .patch(`/api/v1/schools/${schoolId}/sections/${sectionId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ teacherEmail: teacher.email })
        .expect(403);
      expect(res.body.error.code).toBe("PERMISSION_DENIED");
    }
  });

  it("rejects non-teacher and unknown emails with 404, foreign sections with 404", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const sectionA = await makeSection(schoolA.schoolId);
    const sectionB = await makeSection(schoolB.schoolId);

    const notTeacher = await request(app)
      .patch(`/api/v1/schools/${schoolA.schoolId}/sections/${sectionA}`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ teacherEmail: schoolA.adminEmail })
      .expect(404);
    expect(notTeacher.body.error.code).toBe("TEACHER_NOT_FOUND");

    const unknown = await request(app)
      .patch(`/api/v1/schools/${schoolA.schoolId}/sections/${sectionA}`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ teacherEmail: `ghost-${uid()}@example.com` })
      .expect(404);
    expect(unknown.body.error.code).toBe("TEACHER_NOT_FOUND");

    const foreign = await request(app)
      .patch(`/api/v1/schools/${schoolA.schoolId}/sections/${sectionB}`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ teacherEmail: schoolA.adminEmail })
      .expect(404);
    expect(foreign.body.error.code).toBe("SECTION_NOT_FOUND");
  });

  it("lets a teacher list sections but rejects anonymous callers", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    void adminToken;
    await makeSection(schoolId);
    const teacher = await makeStaff(schoolId, slug, "TEACHER");

    await request(app)
      .get(`/api/v1/schools/${schoolId}/sections`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(200);

    await request(app).get(`/api/v1/schools/${schoolId}/sections`).expect(401);
  });

  it("lists the school's subjects (dropdown data, tenant-scoped)", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const subject = await prisma.subject.create({ data: { schoolId: schoolA.schoolId, name: `Subject ${uid()}`, group: "Core" } });

    const list = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/subjects`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .expect(200);
    const names = (list.body.data.subjects as { id: string; name: string }[]).map((s) => s.name);
    expect(names).toContain(subject.name);

    // Other school's list carries none of these rows.
    const foreign = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/subjects`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(200);
    expect((foreign.body.data.subjects as { name: string }[]).map((s) => s.name)).not.toContain(subject.name);

    await request(app).get(`/api/v1/schools/${schoolA.schoolId}/subjects`).expect(401);
  }, 30000);
});
