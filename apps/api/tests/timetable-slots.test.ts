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
      schoolName: `Slot School ${uid()}`,
      adminName: "Slot Admin",
      adminEmail: `slot-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSection(schoolId: string, name = "A"): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name } });
  return section.id;
}

async function makeSubject(schoolId: string): Promise<string> {
  const subject = await prisma.subject.create({ data: { schoolId, name: `Subject ${uid()}`, group: "Core" } });
  return subject.id;
}

async function makeTeacher(
  schoolId: string,
  slug: string,
  qualifiedSubjectIds: string[],
): Promise<{ token: string; staffId: string }> {
  const email = `slot-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const role = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  if (!role) {
    throw new Error("TEACHER role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Slot Teacher" },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  for (const subjectId of qualifiedSubjectIds) {
    await prisma.teacherSubject.create({ data: { schoolId, staffId: staff.id, subjectId } });
  }
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, staffId: staff.id };
}

describe("manual timetable slots (post-generation adjustments)", () => {
  it("adds, blocks double-books, enforces qualifications, deletes", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId, "A");
    const sectionB = await makeSection(schoolId, "B");
    const math = await makeSubject(schoolId);
    const art = await makeSubject(schoolId);
    const teacher = await makeTeacher(schoolId, slug, [math]);

    const added = await request(app)
      .post(`/api/v1/schools/${schoolId}/timetable/slots`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId: sectionA, subjectId: math, teacherId: teacher.staffId, dayOfWeek: 1, period: 1 })
      .expect(201);
    const slotId = added.body.data.slot.id as string;

    // Same section, same time: taken.
    const sectionClash = await request(app)
      .post(`/api/v1/schools/${schoolId}/timetable/slots`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId: sectionA, subjectId: math, teacherId: teacher.staffId, dayOfWeek: 1, period: 2 })
      .expect(201);
    void sectionClash;
    const taken = await request(app)
      .post(`/api/v1/schools/${schoolId}/timetable/slots`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId: sectionA, subjectId: math, teacherId: teacher.staffId, dayOfWeek: 1, period: 1 })
      .expect(409);
    expect(taken.body.error.code).toBe("SLOT_TAKEN");

    // Same teacher, other section, same time: busy.
    const busy = await request(app)
      .post(`/api/v1/schools/${schoolId}/timetable/slots`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId: sectionB, subjectId: math, teacherId: teacher.staffId, dayOfWeek: 1, period: 1 })
      .expect(409);
    expect(busy.body.error.code).toBe("TEACHER_BUSY");

    // Qualified nowhere for art: rejected, fixable via qualifications.
    const unqualified = await request(app)
      .post(`/api/v1/schools/${schoolId}/timetable/slots`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId: sectionB, subjectId: art, teacherId: teacher.staffId, dayOfWeek: 2, period: 1 })
      .expect(409);
    expect(unqualified.body.error.code).toBe("TEACHER_NOT_QUALIFIED");

    await request(app)
      .delete(`/api/v1/schools/${schoolId}/timetable/slots/${slotId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const gone = await request(app)
      .delete(`/api/v1/schools/${schoolId}/timetable/slots/${slotId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);
    expect(gone.body.error.code).toBe("SLOT_NOT_FOUND");
  });

  it("concurrent adds never double-book the same teacher", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId, "A");
    const sectionB = await makeSection(schoolId, "B");
    const math = await makeSubject(schoolId);
    const teacher = await makeTeacher(schoolId, slug, [math]);
    const auth = { Authorization: `Bearer ${adminToken}` };

    const [first, second] = await Promise.all([
      request(app)
        .post(`/api/v1/schools/${schoolId}/timetable/slots`)
        .set(auth)
        .send({ sectionId: sectionA, subjectId: math, teacherId: teacher.staffId, dayOfWeek: 3, period: 2 }),
      request(app)
        .post(`/api/v1/schools/${schoolId}/timetable/slots`)
        .set(auth)
        .send({ sectionId: sectionB, subjectId: math, teacherId: teacher.staffId, dayOfWeek: 3, period: 2 }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe("TEACHER_BUSY");
    expect(
      await prisma.timetableSlot.count({ where: { schoolId, teacherId: teacher.staffId, dayOfWeek: 3, period: 2 } }),
    ).toBe(1);
  });

  it("rejects foreign ids, teacher callers, and strangers", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const sectionA = await makeSection(schoolA.schoolId);
    const mathA = await makeSubject(schoolA.schoolId);
    const mathB = await makeSubject(schoolB.schoolId);
    const teacherA = await makeTeacher(schoolA.schoolId, schoolA.slug, [mathA]);

    const foreignSubject = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/timetable/slots`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ sectionId: sectionA, subjectId: mathB, teacherId: teacherA.staffId, dayOfWeek: 1, period: 1 })
      .expect(404);
    expect(foreignSubject.body.error.code).toBe("SUBJECT_NOT_FOUND");

    const foreignSection = await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/timetable/slots`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .send({ sectionId: sectionA, subjectId: mathB, teacherId: teacherA.staffId, dayOfWeek: 1, period: 1 })
      .expect(404);
    expect(foreignSection.body.error.code).toBe("SECTION_NOT_FOUND");

    const teacherCaller = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/timetable/slots`)
      .set("Authorization", `Bearer ${teacherA.token}`)
      .send({ sectionId: sectionA, subjectId: mathA, teacherId: teacherA.staffId, dayOfWeek: 1, period: 1 })
      .expect(403);
    expect(teacherCaller.body.error.code).toBe("PERMISSION_DENIED");

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/timetable/slots`)
      .send({ sectionId: sectionA, subjectId: mathA, teacherId: teacherA.staffId, dayOfWeek: 1, period: 1 })
      .expect(401);
  });
});
