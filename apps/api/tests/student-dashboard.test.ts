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
      schoolName: `Student Board School ${uid()}`,
      adminName: "Student Board Admin",
      adminEmail: `student-board-admin-${uid()}@example.com`,
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
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `Board ${roleName}` },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id };
}

async function setupSchool(): Promise<{
  schoolId: string;
  slug: string;
  adminToken: string;
  sectionId: string;
  classId: string;
  subjectId: string;
  teacherToken: string;
  pupil: { token: string; userId: string; studentId: string };
}> {
  const { schoolId, slug, adminToken } = await registerSchool();
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const subject = await prisma.subject.create({ data: { schoolId, name: `Subject ${uid()}`, group: "Core" } });
  const teacher = await makeUser(schoolId, slug, "TEACHER");
  const staff = await prisma.staff.create({ data: { schoolId, userId: teacher.userId, designation: "Teacher" } });
  await prisma.section.update({ where: { id: section.id }, data: { classTeacherId: staff.id } });
  await prisma.teacherSubject.create({ data: { schoolId, staffId: staff.id, subjectId: subject.id } });
  const pupilUser = await makeUser(schoolId, slug, "STUDENT");
  const profile = await prisma.student.create({ data: { schoolId, userId: pupilUser.userId, sectionId: section.id } });
  return {
    schoolId, slug, adminToken, sectionId: section.id, classId: cls.id, subjectId: subject.id,
    teacherToken: teacher.token,
    pupil: { ...pupilUser, studentId: profile.id },
  };
}

interface StudentBundle {
  attendancePercent: number | null;
  overallMarks: number | null;
  feesDue: string;
  nextExam: { id: string; title: string; date: string | null } | null;
  todayTimetable: { period: number; subjectName: string }[];
  recentMarks: { subjectName: string; examName: string; obtained: string | null; percent: number | null }[];
  recentNotices: { id: string; title: string }[];
  asOf: { day: string };
}

describe("GET /api/v1/schools/:schoolId/dashboard/student (§8.3)", () => {
  it(
    "returns attendance %, marks, fees due, next exam, timetable, marks, notices",
    async () => {
      const school = await setupSchool();
      const day = schoolDay("Asia/Kolkata", new Date());

      // Attendance: one PRESENT → 100%.
      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/attendance`)
        .set("Authorization", `Bearer ${school.teacherToken}`)
        .send({ sectionId: school.sectionId, date: day, records: [{ studentId: school.pupil.studentId, status: "PRESENT" }] })
        .expect(200);

      // Exam + marks: 40/50 → 80%.
      const exam = await request(app)
        .post(`/api/v1/schools/${school.schoolId}/exams`)
        .set("Authorization", `Bearer ${school.adminToken}`)
        .send({ name: "Board Unit Test", startDate: "2026-11-01", endDate: "2026-11-05", subjects: [{ subjectId: school.subjectId, maxMarks: 50 }] })
        .expect(201);
      const examSubjectId = exam.body.data.exam.examSubjects[0].id as string;
      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/exams/${exam.body.data.exam.id as string}/marks`)
        .set("Authorization", `Bearer ${school.adminToken}`)
        .send({ examSubjectId, sectionId: school.sectionId, records: [{ studentId: school.pupil.studentId, marksObtained: 40 }] })
        .expect(200);

      // Fees: 10000 invoice, 3000 paid → 7000 due.
      const structure = await request(app)
        .post(`/api/v1/schools/${school.schoolId}/fees/structures`)
        .set("Authorization", `Bearer ${school.adminToken}`)
        .send({ classId: school.classId, name: `Board Term ${uid()}`, amount: "10000.00", term: "Term 1", category: "TUITION" })
        .expect(201);
      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/fees/invoices/generate`)
        .set("Authorization", `Bearer ${school.adminToken}`)
        .send({ structureId: structure.body.data.structure.id as string, classId: school.classId, dueDate: "2026-12-31" })
        .expect(201);
      const invoice = await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId: school.schoolId, studentId: school.pupil.studentId } });
      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/fees/invoices/${invoice.id}/pay`)
        .set("Authorization", `Bearer ${school.adminToken}`)
        .send({ amount: "3000", method: "CASH" })
        .expect(200);

      // Today's slot + a school-wide notice.
      const staff = await prisma.staff.findFirstOrThrow({ where: { schoolId: school.schoolId } });
      await prisma.timetableSlot.create({
        data: { schoolId: school.schoolId, sectionId: school.sectionId, subjectId: school.subjectId, teacherId: staff.id, dayOfWeek: schoolWeekday("Asia/Kolkata", new Date()), period: 1 },
      });
      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/notices`)
        .set("Authorization", `Bearer ${school.adminToken}`)
        .send({ title: "Board Assembly Notice", body: "Assembly moves to the main ground starting Monday for all students." })
        .expect(201);

      const res = await request(app)
        .get(`/api/v1/schools/${school.schoolId}/dashboard/student`)
        .set("Authorization", `Bearer ${school.pupil.token}`)
        .expect(200);
      const board = res.body.data.dashboard as StudentBundle;
      expect(board.attendancePercent).toBe(100);
      expect(board.overallMarks).toBe(80);
      expect(board.feesDue).toBe("7000.00");
      expect(board.nextExam).toMatchObject({ title: "Board Unit Test", date: "2026-11-01" });
      expect(board.todayTimetable).toHaveLength(1);
      expect(board.recentMarks).toHaveLength(1);
      expect(board.recentMarks[0]).toMatchObject({ obtained: "40.00", percent: 80 });
      expect(board.recentNotices.map((n) => n.title)).toContain("Board Assembly Notice");
      expect(board.asOf.day).toBe(day);
    },
    30000,
  );

  it(
    "returns honest nulls for a fresh student and refreshes on writes",
    async () => {
      const school = await setupSchool();
      const before = await request(app)
        .get(`/api/v1/schools/${school.schoolId}/dashboard/student`)
        .set("Authorization", `Bearer ${school.pupil.token}`)
        .expect(200);
      const empty = before.body.data.dashboard as StudentBundle;
      expect(empty.attendancePercent).toBeNull();
      expect(empty.overallMarks).toBeNull();
      expect(empty.feesDue).toBe("0.00");
      expect(empty.nextExam).toBeNull();

      // Mark + pay through the routes → the board refreshes (invalidation).
      const day = schoolDay("Asia/Kolkata", new Date());
      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/attendance`)
        .set("Authorization", `Bearer ${school.teacherToken}`)
        .send({ sectionId: school.sectionId, date: day, records: [{ studentId: school.pupil.studentId, status: "LATE" }] })
        .expect(200);
      const after = await request(app)
        .get(`/api/v1/schools/${school.schoolId}/dashboard/student`)
        .set("Authorization", `Bearer ${school.pupil.token}`)
        .expect(200);
      expect((after.body.data.dashboard as StudentBundle).attendancePercent).toBe(50);
    },
    30000,
  );

  it(
    "is student-only: staff, parents, strangers, cross-tenant all denied",
    async () => {
      const schoolA = await setupSchool();
      const schoolB = await setupSchool();
      const teacherB = await makeUser(schoolB.schoolId, schoolB.slug, "TEACHER");
      const parentA = await makeUser(schoolA.schoolId, schoolA.slug, "PARENT");

      for (const [token, code] of [
        [schoolA.adminToken, "FORBIDDEN"],
        [schoolA.teacherToken, "FORBIDDEN"],
        // Parent holds dashboard.read (own board) but not the student role.
        [parentA.token, "FORBIDDEN"],
      ] as const) {
        const denied = await request(app)
          .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/student`)
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
        expect(denied.body.error.code).toBe(code);
      }

      const pupilB = await makeUser(schoolB.schoolId, schoolB.slug, "STUDENT");
      const cross = await request(app)
        .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/student`)
        .set("Authorization", `Bearer ${pupilB.token}`)
        .expect(403);
      expect(cross.body.error.code).toBe("TENANT_MISMATCH");

      // STUDENT role but no student profile: clear denial, not a leak.
      const ghost = await makeUser(schoolA.schoolId, schoolA.slug, "STUDENT");
      const noProfile = await request(app)
        .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/student`)
        .set("Authorization", `Bearer ${ghost.token}`)
        .expect(403);
      expect(noProfile.body.error.code).toBe("NOT_A_STUDENT");

      // Another student's token can't open this pupil's board either: the
      // board always resolves the CALLER, so B-student on B-URL sees only B.
      void teacherB;
      await request(app).get(`/api/v1/schools/${schoolA.schoolId}/dashboard/student`).expect(401);
    },
    30000,
  );
});
