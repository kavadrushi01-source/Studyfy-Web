import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { schoolDay, schoolWeekday } from "../src/lib/school-time.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Teacher Board School ${uid()}`,
      adminName: "Teacher Board Admin",
      adminEmail: `teacher-board-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  await prisma.school.update({ where: { id: schoolId }, data: { timezone: "Asia/Kolkata" } });
  return { schoolId, slug: res.body.data.school.slug as string, adminToken: res.body.data.accessToken as string };
}

async function makeTeacher(
  schoolId: string,
  slug: string,
  sectionId: string | null,
  subjectIds: string[],
): Promise<{ token: string; userId: string; staffId: string }> {
  const email = `board-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Board Teacher" },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  if (sectionId) {
    await prisma.section.update({ where: { id: sectionId }, data: { classTeacherId: staff.id } });
  }
  for (const subjectId of subjectIds) {
    await prisma.teacherSubject.create({ data: { schoolId, staffId: staff.id, subjectId } });
  }
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id, staffId: staff.id };
}

async function makeStudent(schoolId: string, slug: string, sectionId: string): Promise<{ token: string; userId: string; studentId: string }> {
  const email = `board-pupil-${uid()}@example.com`;
  const password = "pupil-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Board Pupil" },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  const profile = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  return { token: login.body.data.accessToken as string, userId: user.id, studentId: profile.id };
}

interface TeacherBundle {
  myClasses: { id: string; name: string; className: string }[];
  todayAttendance: { sectionId: string; marked: boolean; present: number; total: number }[];
  homeworkPending: number;
  unreadMessages: number;
  todayTimetable: { period: number; subjectName: string; sectionName: string }[];
  upcomingHomework: { id: string; title: string; date: string | null }[];
  upcomingExams: { id: string; title: string; date: string | null }[];
  recentMessages: { user: { id: string; name: string }; lastBody: string; unread: number }[];
  asOf: { day: string };
}

describe("GET /api/v1/schools/:schoolId/dashboard/teacher (§8.3)", () => {
  it(
    "returns the Today view: classes, attendance, pending, unread, timetable, upcoming, recent",
    async () => {
      const { schoolId, slug, adminToken } = await registerSchool();
      const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
      const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
      const math = await prisma.subject.create({ data: { schoolId, name: `Subject ${uid()}`, group: "Core" } });
      const teacher = await makeTeacher(schoolId, slug, section.id, [math.id]);
      const pupil = await makeStudent(schoolId, slug, section.id);

      // A slot for TODAY's school weekday, so the timetable panel is live.
      const weekday = schoolWeekday("Asia/Kolkata", new Date());
      await prisma.timetableSlot.create({
        data: { schoolId, sectionId: section.id, subjectId: math.id, teacherId: teacher.staffId, dayOfWeek: weekday, period: 2 },
      });
      // Future homework + future exam → upcoming lists.
      const hw = await request(app)
        .post(`/api/v1/schools/${schoolId}/homework`)
        .set("Authorization", `Bearer ${teacher.token}`)
        .send({ sectionId: section.id, subjectId: math.id, title: "Board Worksheet", description: "Problems for the board test.", dueDate: "2026-12-01" })
        .expect(201);
      await request(app)
        .post(`/api/v1/schools/${schoolId}/exams`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Board Unit Test", startDate: "2026-11-01", endDate: "2026-11-05", subjects: [{ subjectId: math.id, maxMarks: 50 }] })
        .expect(201);
      // One submission to grade + one unread message.
      await request(app)
        .post(`/api/v1/schools/${schoolId}/homework/${hw.body.data.homework.id as string}/submissions`)
        .set("Authorization", `Bearer ${pupil.token}`)
        .field("content", "Board answers.")
        .expect(201);
      await request(app)
        .post(`/api/v1/schools/${schoolId}/messages`)
        .set("Authorization", `Bearer ${pupil.token}`)
        .send({ receiverId: teacher.userId, body: "Board hello." })
        .expect(201);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolId}/dashboard/teacher`)
        .set("Authorization", `Bearer ${teacher.token}`)
        .expect(200);
      const board = res.body.data.dashboard as TeacherBundle;
      expect(board.myClasses).toHaveLength(1);
      expect(board.todayAttendance).toHaveLength(1);
      expect(board.todayAttendance[0]?.marked).toBe(false);
      expect(board.homeworkPending).toBe(1);
      expect(board.unreadMessages).toBe(1);
      expect(board.todayTimetable).toHaveLength(1);
      expect(board.todayTimetable[0]).toMatchObject({ period: 2 });
      expect(board.upcomingHomework.map((h) => h.title)).toContain("Board Worksheet");
      expect(board.upcomingExams.map((e) => e.title)).toContain("Board Unit Test");
      expect(board.recentMessages).toHaveLength(1);
      expect(board.recentMessages[0]?.lastBody).toBe("Board hello.");
      expect(board.recentMessages[0]?.unread).toBe(1);
      expect(board.asOf.day).toBe(schoolDay("Asia/Kolkata", new Date()));
    },
    30000,
  );

  it(
    "reflects marking through the route (write invalidates the board)",
    async () => {
      const { schoolId, slug } = await registerSchool();
      const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
      const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
      const teacher = await makeTeacher(schoolId, slug, section.id, []);
      const pupil = await makeStudent(schoolId, slug, section.id);

      const before = await request(app)
        .get(`/api/v1/schools/${schoolId}/dashboard/teacher`)
        .set("Authorization", `Bearer ${teacher.token}`)
        .expect(200);
      expect((before.body.data.dashboard as TeacherBundle).todayAttendance[0]?.marked).toBe(false);

      const day = schoolDay("Asia/Kolkata", new Date());
      await request(app)
        .post(`/api/v1/schools/${schoolId}/attendance`)
        .set("Authorization", `Bearer ${teacher.token}`)
        .send({ sectionId: section.id, date: day, records: [{ studentId: pupil.studentId, status: "PRESENT" }] })
        .expect(200);

      const after = await request(app)
        .get(`/api/v1/schools/${schoolId}/dashboard/teacher`)
        .set("Authorization", `Bearer ${teacher.token}`)
        .expect(200);
      expect(after.body.data.dashboard as TeacherBundle).toMatchObject({
        todayAttendance: [{ marked: true, present: 1, total: 1 }],
      });
    },
    30000,
  );

  it(
    "is teacher-only: admin, students, strangers, and cross-tenant all denied",
    async () => {
      const schoolA = await registerSchool();
      const schoolB = await registerSchool();
      const cls = await prisma.class.create({ data: { schoolId: schoolA.schoolId, name: `Class ${uid()}` } });
      const section = await prisma.section.create({ data: { schoolId: schoolA.schoolId, classId: cls.id, name: "A" } });
      const pupil = await makeStudent(schoolA.schoolId, schoolA.slug, section.id);

      // Admin holds the key but not the role.
      const adminDenied = await request(app)
        .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/teacher`)
        .set("Authorization", `Bearer ${schoolA.adminToken}`)
        .expect(403);
      expect(adminDenied.body.error.code).toBe("FORBIDDEN");

      // Student holds dashboard.read (own board) but not the teacher role.
      const pupilDenied = await request(app)
        .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/teacher`)
        .set("Authorization", `Bearer ${pupil.token}`)
        .expect(403);
      expect(pupilDenied.body.error.code).toBe("FORBIDDEN");

      // B's teacher on A's URL: tenant mismatch before anything else.
      const other = await makeTeacher(schoolB.schoolId, schoolB.slug, null, []);
      const cross = await request(app)
        .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/teacher`)
        .set("Authorization", `Bearer ${other.token}`)
        .expect(403);
      expect(cross.body.error.code).toBe("TENANT_MISMATCH");

      // A TEACHER user with no staff profile gets a clear denial, not a leak.
      const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
      const email = `profileless-${uid()}@example.com`;
      const password = "profileless-123";
      await prisma.user.create({
        data: { schoolId: schoolA.schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "No Profile" },
      });
      const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: schoolA.slug }).expect(200);
      const noProfile = await request(app)
        .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/teacher`)
        .set("Authorization", `Bearer ${login.body.data.accessToken as string}`)
        .expect(403);
      expect(noProfile.body.error.code).toBe("NOT_A_TEACHER");

      await request(app).get(`/api/v1/schools/${schoolA.schoolId}/dashboard/teacher`).expect(401);
    },
    30000,
  );
});
