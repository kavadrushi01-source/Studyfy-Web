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
      schoolName: `List School ${uid()}`,
      adminName: "List Admin",
      adminEmail: `list-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSections(schoolId: string): Promise<{ aId: string; bId: string }> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const a = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const b = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "B" } });
  return { aId: a.id, bId: b.id };
}

async function makeStudent(schoolId: string, sectionId: string, name: string): Promise<string> {
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: `${name.toLowerCase().replace(/[^a-z]/g, "")}-${uid()}@example.com`,
      passwordHash: "x",
      name,
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  return student.id;
}

async function loginAsTeacher(schoolId: string, slug: string, staffSections: string[]): Promise<string> {
  const email = `lteach-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  if (!role) {
    throw new Error("TEACHER role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "List Teacher" },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  for (const sectionId of staffSections) {
    await prisma.section.update({ where: { id: sectionId }, data: { classTeacherId: staff.id } });
  }
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

describe("GET /api/v1/schools/:schoolId/students (table controls)", () => {
  it("paginates, sorts by name, and reports totals in meta", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const { aId } = await makeSections(schoolId);
    await makeStudent(schoolId, aId, "Zebra Kid");
    await makeStudent(schoolId, aId, "Mango Kid");
    await makeStudent(schoolId, aId, "Apple Kid");

    const page1 = await request(app)
      .get(`/api/v1/schools/${schoolId}/students?page=1&pageSize=2&sort=name&order=asc`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(page1.body.meta).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    const names1 = (page1.body.data.students as { user: { name: string } }[]).map((s) => s.user.name);
    expect(names1).toEqual(["Apple Kid", "Mango Kid"]);

    const page2 = await request(app)
      .get(`/api/v1/schools/${schoolId}/students?page=2&pageSize=2&sort=name&order=asc`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect((page2.body.data.students as { user: { name: string } }[]).map((s) => s.user.name)).toEqual(["Zebra Kid"]);
  });

  it("filters by search text and section", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const { aId, bId } = await makeSections(schoolId);
    await makeStudent(schoolId, aId, "Searchable One");
    await makeStudent(schoolId, bId, "Other Two");

    const search = await request(app)
      .get(`/api/v1/schools/${schoolId}/students?search=searchable`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(search.body.meta.total).toBe(1);

    const section = await request(app)
      .get(`/api/v1/schools/${schoolId}/students?sectionId=${bId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(section.body.meta.total).toBe(1);
    expect((section.body.data.students as { user: { name: string } }[])[0]?.user.name).toBe("Other Two");
  });

  it("rejects an unknown sort field with 400", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/students?sort=password`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("shows a teacher only their own sections' students", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const { aId, bId } = await makeSections(schoolId);
    await makeStudent(schoolId, aId, "Section A Kid");
    await makeStudent(schoolId, bId, "Section B Kid");
    const teacherToken = await loginAsTeacher(schoolId, slug, [aId]);

    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/students?pageSize=50`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);
    expect(res.body.meta.total).toBe(1);
    expect((res.body.data.students as { user: { name: string } }[])[0]?.user.name).toBe("Section A Kid");

    // Admin still sees both.
    const admin = await request(app)
      .get(`/api/v1/schools/${schoolId}/students?pageSize=50`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(admin.body.meta.total).toBe(2);
  });

  it("shows a teacher with no assigned sections an empty list (fail-closed)", async () => {
    const { schoolId, slug } = await registerSchool();
    const { aId } = await makeSections(schoolId);
    await makeStudent(schoolId, aId, "Unassigned Section Kid");
    const teacherToken = await loginAsTeacher(schoolId, slug, []);

    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/students`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);
    expect(res.body.meta.total).toBe(0);
    expect(res.body.data.students).toEqual([]);
  });
});
