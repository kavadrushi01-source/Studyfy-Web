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
      schoolName: `Parent Board School ${uid()}`,
      adminName: "Parent Board Admin",
      adminEmail: `parent-board-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  await prisma.school.update({ where: { id: schoolId }, data: { timezone: "Asia/Kolkata" } });
  return { schoolId, slug: res.body.data.school.slug as string, adminToken: res.body.data.accessToken as string };
}

async function makeUser(
  schoolId: string,
  slug: string,
  roleName: string,
): Promise<{ token: string; userId: string }> {
  const email = `board-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "board-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `Board ${roleName} ${uid()}` },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id };
}

async function setupFamily(): Promise<{
  schoolId: string;
  slug: string;
  adminToken: string;
  sectionId: string;
  subjectIds: string[];
  parentToken: string;
  childA: string;
  childB: string;
}> {
  const { schoolId, slug, adminToken } = await registerSchool();
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const math = await prisma.subject.create({ data: { schoolId, name: `Math ${uid()}`, group: "Core" } });
  const eng = await prisma.subject.create({ data: { schoolId, name: `Eng ${uid()}`, group: "Core" } });

  const mkPupil = async (name: string) => {
    const u = await makeUser(schoolId, slug, "STUDENT");
    await prisma.user.update({ where: { id: u.userId }, data: { name } });
    const profile = await prisma.student.create({ data: { schoolId, userId: u.userId, sectionId: section.id } });
    return profile.id;
  };
  // Names chosen so alphabetical order is deterministic: Anna before Zara.
  const childA = await mkPupil(`Anna ${uid()}`);
  const childB = await mkPupil(`Zara ${uid()}`);

  const parent = await makeUser(schoolId, slug, "PARENT");
  for (const studentId of [childA, childB]) {
    await prisma.studentGuardian.create({ data: { schoolId, studentId, parentId: parent.userId, relationship: "Father" } });
  }
  return { schoolId, slug, adminToken, sectionId: section.id, subjectIds: [math.id, eng.id], parentToken: parent.token, childA, childB };
}

interface ParentBundle {
  children: { studentId: string; name: string }[];
  selectedChildId: string;
  board: {
    attendancePercent: number | null;
    overallMarks: number | null;
    feesDue: string;
    progressBySubject: { subjectName: string; percent: number; scored: number }[];
    recentNotices: { id: string; title: string }[];
  };
}

describe("GET /api/v1/schools/:schoolId/dashboard/parent (§8.3)", () => {
  it(
    "lists linked children, defaults to the first, and selects ?with=",
    async () => {
      const family = await setupFamily();

      // Marks for child A only: math 40/50, eng 30/50.
      const exam = await request(app)
        .post(`/api/v1/schools/${family.schoolId}/exams`)
        .set("Authorization", `Bearer ${family.adminToken}`)
        .send({
          name: "Parent Board Test",
          startDate: "2026-11-01",
          endDate: "2026-11-05",
          subjects: [
            { subjectId: family.subjectIds[0], maxMarks: 50 },
            { subjectId: family.subjectIds[1], maxMarks: 50 },
          ],
        })
        .expect(201);
      const subjects = exam.body.data.exam.examSubjects as { id: string }[];
      for (const [i, subject] of subjects.entries()) {
        await request(app)
          .post(`/api/v1/schools/${family.schoolId}/exams/${exam.body.data.exam.id as string}/marks`)
          .set("Authorization", `Bearer ${family.adminToken}`)
          .send({ examSubjectId: subject.id, sectionId: family.sectionId, records: [{ studentId: family.childA, marksObtained: i === 0 ? 40 : 30 }] })
          .expect(200);
      }

      const def = await request(app)
        .get(`/api/v1/schools/${family.schoolId}/dashboard/parent`)
        .set("Authorization", `Bearer ${family.parentToken}`)
        .expect(200);
      const first = def.body.data.dashboard as ParentBundle;
      expect(first.children).toHaveLength(2);
      expect(first.children[0]?.studentId).toBe(family.childA);
      expect(first.selectedChildId).toBe(family.childA);
      expect(first.board.overallMarks).toBe(70);
      expect(first.board.progressBySubject).toHaveLength(2);
      // Sorted by subject name: Eng 30/50 first, Math 40/50 second.
      expect(first.board.progressBySubject[0]).toMatchObject({ percent: 60, scored: 1 });
      expect(first.board.progressBySubject[1]).toMatchObject({ percent: 80, scored: 1 });

      const other = await request(app)
        .get(`/api/v1/schools/${family.schoolId}/dashboard/parent?with=${family.childB}`)
        .set("Authorization", `Bearer ${family.parentToken}`)
        .expect(200);
      const zara = other.body.data.dashboard as ParentBundle;
      expect(zara.selectedChildId).toBe(family.childB);
      expect(zara.board.overallMarks).toBeNull();
      expect(zara.board.progressBySubject).toHaveLength(0);
    },
    30000,
  );

  it(
    "refuses unlinked children, strangers, and wrong roles",
    async () => {
      const family = await setupFamily();
      const otherParent = await makeUser(family.schoolId, family.slug, "PARENT");
      const otherPupil = await makeUser(family.schoolId, family.slug, "STUDENT");
      const otherProfile = await prisma.student.create({
        data: { schoolId: family.schoolId, userId: otherPupil.userId, sectionId: family.sectionId },
      });
      await prisma.studentGuardian.create({
        data: { schoolId: family.schoolId, studentId: otherProfile.id, parentId: otherParent.userId, relationship: "Mother" },
      });
      const linkless = await makeUser(family.schoolId, family.slug, "PARENT");

      // Another parent's child, and a gibberish id: both 403, never widened.
      for (const withId of [family.childA, "student-that-does-not-exist"]) {
        const denied = await request(app)
          .get(`/api/v1/schools/${family.schoolId}/dashboard/parent?with=${withId}`)
          .set("Authorization", `Bearer ${otherParent.token}`)
          .expect(403);
        expect(denied.body.error.code).toBe("FORBIDDEN");
      }
      // Same for the linked parent asking for a stranger's child.
      const stranger = await request(app)
        .get(`/api/v1/schools/${family.schoolId}/dashboard/parent?with=${otherProfile.id}`)
        .set("Authorization", `Bearer ${family.parentToken}`)
        .expect(403);
      expect(stranger.body.error.code).toBe("FORBIDDEN");

      // PARENT role with no linked children: clear denial, not an empty lie.
      const noLinks = await request(app)
        .get(`/api/v1/schools/${family.schoolId}/dashboard/parent`)
        .set("Authorization", `Bearer ${linkless.token}`)
        .expect(403);
      expect(noLinks.body.error.code).toBe("NOT_A_PARENT");

      // Teachers and admins hold the key but not the role; students hold
      // the key but not the role either — all FORBIDDEN, never the data.
      const teacher = await makeUser(family.schoolId, family.slug, "TEACHER");
      for (const token of [family.adminToken, teacher.token]) {
        const denied = await request(app)
          .get(`/api/v1/schools/${family.schoolId}/dashboard/parent`)
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
        expect(denied.body.error.code).toBe("FORBIDDEN");
      }
      const pupilDenied = await request(app)
        .get(`/api/v1/schools/${family.schoolId}/dashboard/parent`)
        .set("Authorization", `Bearer ${otherPupil.token}`)
        .expect(403);
      expect(pupilDenied.body.error.code).toBe("FORBIDDEN");

      await request(app).get(`/api/v1/schools/${family.schoolId}/dashboard/parent`).expect(401);
    },
    30000,
  );

  it(
    "blocks cross-tenant reads",
    async () => {
      const schoolA = await setupFamily();
      const schoolB = await registerSchool();
      const parentB = await makeUser(schoolB.schoolId, schoolB.slug, "PARENT");
      const cross = await request(app)
        .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/parent`)
        .set("Authorization", `Bearer ${parentB.token}`)
        .expect(403);
      expect(cross.body.error.code).toBe("TENANT_MISMATCH");
    },
    30000,
  );
});
