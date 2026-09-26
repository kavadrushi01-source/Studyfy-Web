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
      schoolName: `Scope School ${uid()}`,
      adminName: "Scope Admin",
      adminEmail: `scope-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeUser(
  schoolId: string,
  slug: string,
  roleName: string,
  password: string,
): Promise<{ token: string; userId: string }> {
  const email = `scope-${roleName.toLowerCase()}-${uid()}@example.com`;
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`${roleName} role must be seeded`);
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `Scope ${roleName}` },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id };
}

describe("GET /api/v1/schools/:schoolId/timetable/sections", () => {
  it("scopes sections per role: pupil own, parent linked, teacher own, admin all", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const clsA = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
    const clsB = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
    const secA = await prisma.section.create({ data: { schoolId, classId: clsA.id, name: "A" } });
    const secB = await prisma.section.create({ data: { schoolId, classId: clsB.id, name: "B" } });

    const pupil = await makeUser(schoolId, slug, "STUDENT", "pupil-pass-123");
    await prisma.student.create({ data: { schoolId, userId: pupil.userId, sectionId: secA.id } });

    const parent = await makeUser(schoolId, slug, "PARENT", "parent-pass-123");
    const student = await prisma.student.findFirst({ where: { userId: pupil.userId } });
    if (!student) {
      throw new Error("pupil profile must exist");
    }
    await prisma.studentGuardian.create({
      data: { schoolId, studentId: student.id, parentId: parent.userId, relationship: "Father" },
    });

    const teacher = await makeUser(schoolId, slug, "TEACHER", "teacher-pass-123");
    const staff = await prisma.staff.create({ data: { schoolId, userId: teacher.userId, designation: "Teacher" } });
    await prisma.section.update({ where: { id: secB.id }, data: { classTeacherId: staff.id } });

    const pupilRes = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable/sections`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(200);
    expect((pupilRes.body.data.sections as { id: string }[]).map((s) => s.id)).toEqual([secA.id]);

    const parentRes = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable/sections`)
      .set("Authorization", `Bearer ${parent.token}`)
      .expect(200);
    expect((parentRes.body.data.sections as { id: string }[]).map((s) => s.id)).toEqual([secA.id]);

    const teacherRes = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable/sections`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(200);
    expect((teacherRes.body.data.sections as { id: string }[]).map((s) => s.id)).toEqual([secB.id]);

    const adminRes = await request(app)
      .get(`/api/v1/schools/${schoolId}/timetable/sections`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect((adminRes.body.data.sections as { id: string }[]).map((s) => s.id).sort()).toEqual(
      [secA.id, secB.id].sort(),
    );
  });

  it("rejects a foreign school id (cross-tenant)", async () => {
    const first = await registerSchool();
    const second = await registerSchool();
    const pupil = await makeUser(first.schoolId, first.slug, "STUDENT", "pupil-pass-123");
    const sec = await prisma.section.create({
      data: {
        schoolId: first.schoolId,
        classId: (await prisma.class.create({ data: { schoolId: first.schoolId, name: `Class ${uid()}` } })).id,
        name: "A",
      },
    });
    await prisma.student.create({ data: { schoolId: first.schoolId, userId: pupil.userId, sectionId: sec.id } });
    await request(app)
      .get(`/api/v1/schools/${second.schoolId}/timetable/sections`)
      .set("Authorization", `Bearer ${pupil.token}`)
      .expect(403);
  });
});
