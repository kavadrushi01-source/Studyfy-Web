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

async function registerSchool(): Promise<{ schoolId: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Timetable School ${uid()}`,
      adminName: "Timetable Admin",
      adminEmail: `timetable-admin-${uid()}@example.com`,
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

async function makeTeacher(
  schoolId: string,
  subjects: string[],
): Promise<string> {
  const teacherRole = await prisma.role.findUnique({ where: { name: "TEACHER" } });
  if (!teacherRole) {
    throw new Error("TEACHER role must be seeded");
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: teacherRole.id,
      email: `tt-teacher-${uid()}@example.com`,
      passwordHash: "x",
      name: "Timetable Teacher",
    },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  for (const subjectId of subjects) {
    await prisma.teacherSubject.create({ data: { schoolId, staffId: staff.id, subjectId } });
  }
  return staff.id;
}

async function makeSubject(schoolId: string, name: string): Promise<string> {
  const subject = await prisma.subject.create({ data: { schoolId, name: `${name} ${uid()}`, group: "Core" } });
  return subject.id;
}

describe("POST /api/v1/schools/:schoolId/timetable/generate (§10/§11)", () => {
  it("schedules conflict-free and persists slots (no double-booking)", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId);
    const math = await makeSubject(schoolId, "Mathematics");
    const eng = await makeSubject(schoolId, "English");
    await makeTeacher(schoolId, [math]);
    await makeTeacher(schoolId, [math, eng]);

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/timetable/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        demands: [
          { sectionId: sectionA, subjectId: math, periodsPerWeek: 3 },
          { sectionId: sectionA, subjectId: eng, periodsPerWeek: 2 },
        ],
        days: [1, 2, 3, 4, 5],
        periodsPerDay: 6,
      })
      .expect(200);

    expect(res.body.data.unresolved).toEqual([]);
    expect(res.body.data.placed).toHaveLength(5);

    const rows = await prisma.timetableSlot.findMany({ where: { schoolId } });
    expect(rows).toHaveLength(5);
    const sectionSlots = new Set(rows.map((r) => `${r.sectionId}@${r.dayOfWeek}-${r.period}`));
    const teacherSlots = new Set(rows.map((r) => `${r.teacherId}@${r.dayOfWeek}-${r.period}`));
    expect(sectionSlots.size).toBe(5);
    expect(teacherSlots.size).toBe(5);
    // English only has one qualified teacher — every eng slot names them.
    const teacherIds = await prisma.teacherSubject.findMany({ where: { schoolId, subjectId: eng } });
    expect(teacherIds).toHaveLength(1);
    for (const slot of res.body.data.placed as { subjectId: string; teacherId: string }[]) {
      if (slot.subjectId === eng) {
        expect(slot.teacherId).toBe(teacherIds[0]?.staffId);
      }
    }
  });

  it("returns partial + unresolved instead of crashing when impossible", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const math = await makeSubject(schoolId, "Mathematics");
    const latin = await makeSubject(schoolId, "Latin");
    await makeTeacher(schoolId, [math]);

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/timetable/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        demands: [
          { sectionId, subjectId: math, periodsPerWeek: 1 },
          { sectionId, subjectId: latin, periodsPerWeek: 2 },
        ],
        days: [1],
        periodsPerDay: 6,
      })
      .expect(200);

    expect(res.body.data.placed).toHaveLength(1);
    expect(res.body.data.unresolved).toEqual([
      { sectionId, subjectId: latin, periodsMissing: 2, reason: "NO_QUALIFIED_TEACHER", subjectName: expect.any(String) },
    ]);
  });

  it("subset regeneration never double-books a teacher held by an out-of-scope section", async () => {
    // Real incident 2026-10-09: regenerating 9-A alone re-placed Arjun into
    // Monday periods 2+3 while 9-B (outside the demand set) already held him
    // there — the run only avoided collisions inside its own demand. The
    // surviving out-of-scope rows now arrive as blocked occupancy.
    const { schoolId, adminToken } = await registerSchool();
    const sectionA = await makeSection(schoolId);
    const sectionB = await makeSection(schoolId);
    const math = await makeSubject(schoolId, "Mathematics");
    const teacherId = await makeTeacher(schoolId, [math]);

    // Section B's Monday p1 belongs to the only Maths-qualified teacher.
    await request(app)
      .post(`/api/v1/schools/${schoolId}/timetable/slots`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sectionId: sectionB, subjectId: math, teacherId, dayOfWeek: 1, period: 1 })
      .expect(201);

    // Regenerate section A alone over a 2-slot window: d1p1 is taken (by B),
    // so the single lesson must land on d1p2 — never on top of the teacher.
    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/timetable/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        demands: [{ sectionId: sectionA, subjectId: math, periodsPerWeek: 1 }],
        days: [1],
        periodsPerDay: 2,
      })
      .expect(200);

    expect(res.body.data.unresolved).toEqual([]);
    expect(res.body.data.placed).toHaveLength(1);
    expect(res.body.data.placed[0]).toMatchObject({ sectionId: sectionA, day: 1, period: 2, teacherId });

    const rows = await prisma.timetableSlot.findMany({ where: { schoolId } });
    const teacherSlots = new Set(rows.map((r) => `${r.teacherId}@${r.dayOfWeek}-${r.period}`));
    expect(teacherSlots.size).toBe(rows.length);
  });

  it("regenerating replaces (never duplicates), and guards roles/tenants/input", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const sectionA = await makeSection(schoolA.schoolId);
    const math = await makeSubject(schoolA.schoolId, "Mathematics");
    await makeTeacher(schoolA.schoolId, [math]);
    const demand = {
      demands: [{ sectionId: sectionA, subjectId: math, periodsPerWeek: 2 }],
      days: [1, 2],
      periodsPerDay: 6,
    };

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/timetable/generate`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send(demand)
      .expect(200);
    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/timetable/generate`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send(demand)
      .expect(200);
    expect(await prisma.timetableSlot.count({ where: { schoolId: schoolA.schoolId } })).toBe(2);

    // Teacher has no timetable.manage.
    const teacherRole = await prisma.role.findUnique({ where: { name: "TEACHER" } });
    const teacherEmail = `tt-caller-${uid()}@example.com`;
    await prisma.user.create({
      data: {
        schoolId: schoolA.schoolId,
        roleId: teacherRole?.id ?? "",
        email: teacherEmail,
        passwordHash: await bcrypt.hash("teacher-pass-123", 4),
        name: "Caller",
      },
    });
    const teacherLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: teacherEmail, password: "teacher-pass-123", schoolSlug: (await prisma.school.findUnique({ where: { id: schoolA.schoolId } }))?.slug })
      .expect(200);
    const teacherDenied = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/timetable/generate`)
      .set("Authorization", `Bearer ${teacherLogin.body.data.accessToken as string}`)
      .send(demand)
      .expect(403);
    expect(teacherDenied.body.error.code).toBe("PERMISSION_DENIED");
    const cross = await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/timetable/generate`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send(demand)
      .expect(403);
    expect(cross.body.error.code).toBe("TENANT_MISMATCH");

    const foreign = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/timetable/generate`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ demands: [{ sectionId: "cmu00000000000000000000000", subjectId: math, periodsPerWeek: 1 }] })
      .expect(404);
    expect(foreign.body.error.code).toBe("SECTION_NOT_FOUND");

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/timetable/generate`)
      .send(demand)
      .expect(401);
  });
});
