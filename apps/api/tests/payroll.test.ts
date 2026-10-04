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
      schoolName: `Payroll School ${uid()}`,
      adminName: "Payroll Admin",
      adminEmail: `payroll-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeStaff(schoolId: string, slug: string, roleName: string): Promise<{ staffId: string; token: string }> {
  const email = `payroll-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "user-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} Staffer` },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: roleName } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { staffId: staff.id, token: login.body.data.accessToken as string };
}

describe("Payroll (§7 Phase 2 #15, founder schema)", () => {
  it("marks attendance with re-mark overwrite and month filtering", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const auth = { Authorization: `Bearer ${adminToken}` };
    const { staffId } = await makeStaff(schoolId, slug, "TEACHER");

    await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/attendance`)
      .set(auth)
      .send({ staffId, date: "2026-10-05", status: "ABSENT" })
      .expect(201);
    // Re-marking the same day overwrites, never duplicates.
    const rewrite = await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/attendance`)
      .set(auth)
      .send({ staffId, date: "2026-10-05", status: "PRESENT" })
      .expect(201);
    expect(rewrite.body.data.attendance.status).toBe("PRESENT");

    await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/attendance`)
      .set(auth)
      .send({ staffId, date: "2026-11-02", status: "ABSENT" })
      .expect(201);
    const october = await request(app)
      .get(`/api/v1/schools/${schoolId}/payroll/attendance?month=2026-10`)
      .set(auth)
      .expect(200);
    expect(october.body.data.attendance).toHaveLength(1);
    expect(october.body.data.attendance[0]).toMatchObject({ date: "2026-10-05", status: "PRESENT" });
  });

  it("runs leave requests with approve-once and self-filing rules", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const auth = { Authorization: `Bearer ${adminToken}` };
    const teacher = await makeStaff(schoolId, slug, "TEACHER");
    const other = await makeStaff(schoolId, slug, "TEACHER");

    // Staff file leave for themselves (no staffId — resolved from login).
    const mine = await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/leaves`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ dates: ["2026-10-06", "2026-10-07"], reason: "Family function" })
      .expect(201);
    expect(mine.body.data.leave.status).toBe("PENDING");
    expect(mine.body.data.leave.staffId).toBe(teacher.staffId);
    const leaveId = mine.body.data.leave.id as string;

    // Staff cannot file for someone else.
    const sneaky = await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/leaves`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .send({ staffId: other.staffId, dates: ["2026-10-08"], reason: "Nope" })
      .expect(403);
    expect(sneaky.body.error.code).toBe("FORBIDDEN");

    // Office approves once; deciding again is refused.
    const approved = await request(app)
      .patch(`/api/v1/schools/${schoolId}/payroll/leaves/${leaveId}`)
      .set(auth)
      .send({ status: "APPROVED" })
      .expect(200);
    expect(approved.body.data.leave.status).toBe("APPROVED");
    const twice = await request(app)
      .patch(`/api/v1/schools/${schoolId}/payroll/leaves/${leaveId}`)
      .set(auth)
      .send({ status: "REJECTED" })
      .expect(409);
    expect(twice.body.error.code).toBe("ALREADY_DECIDED");

    // Staff see only their own queue.
    const mine2 = await request(app)
      .get(`/api/v1/schools/${schoolId}/payroll/leaves`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(200);
    expect(mine2.body.data.leaves).toHaveLength(1);
  });

  it("computes base minus unpaid absences with approved leave cover", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const auth = { Authorization: `Bearer ${adminToken}` };
    const { staffId } = await makeStaff(schoolId, slug, "TEACHER");

    for (const date of ["2026-10-05", "2026-10-06"]) {
      await request(app)
        .post(`/api/v1/schools/${schoolId}/payroll/attendance`)
        .set(auth)
        .send({ staffId, date, status: "ABSENT" })
        .expect(201);
    }
    // 2026-10-06 is covered by approved leave → only the 5th deducts.
    const leave = await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/leaves`)
      .set(auth)
      .send({ staffId, dates: ["2026-10-06"], reason: "Medical" })
      .expect(201);
    await request(app)
      .patch(`/api/v1/schools/${schoolId}/payroll/leaves/${leave.body.data.leave.id as string}`)
      .set(auth)
      .send({ status: "APPROVED" })
      .expect(200);

    const computed = await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/compute`)
      .set(auth)
      .send({ staffId, month: "2026-10", baseSalary: 30000 })
      .expect(201);
    // 1 unpaid day × (30000/30) = 1000.00; net 29000.00.
    expect(computed.body.data.payroll).toMatchObject({
      month: "2026-10",
      baseSalary: "30000.00",
      deductions: "1000.00",
      netPay: "29000.00",
    });
    expect(computed.body.data.breakdown).toMatchObject({ unpaidDays: 1, perDayRate: "1000.00" });

    // Recomputing replaces the row — still exactly one row for the month.
    await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/compute`)
      .set(auth)
      .send({ staffId, month: "2026-10", baseSalary: 30000 })
      .expect(201);
    const rows = await request(app).get(`/api/v1/schools/${schoolId}/payroll?month=2026-10`).set(auth).expect(200);
    expect(rows.body.data.payroll).toHaveLength(1);
  });

  it("enforces tenancy and office-only writes", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const { staffId } = await makeStaff(schoolA.schoolId, schoolA.slug, "TEACHER");
    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/payroll/attendance`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ staffId, date: "2026-10-05", status: "PRESENT" })
      .expect(201);

    // Stranger school sees nothing (tenant scope, never a leak).
    const cross = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/payroll/attendance?month=2026-10`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(200);
    expect(cross.body.data.attendance).toEqual([]);
    await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/payroll/compute`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .send({ staffId, month: "2026-10", baseSalary: 30000 })
      .expect(404);

    // Teachers read but never run payroll.
    const teacher = await makeStaff(schoolA.schoolId, schoolA.slug, "TEACHER");
    await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/payroll`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(200);
    for (const call of [
      request(app).post(`/api/v1/schools/${schoolA.schoolId}/payroll/attendance`),
      request(app).post(`/api/v1/schools/${schoolA.schoolId}/payroll/compute`),
    ]) {
      const denied = await call
        .set("Authorization", `Bearer ${teacher.token}`)
        .send({ staffId: teacher.staffId, date: "2026-10-05", status: "PRESENT", month: "2026-10", baseSalary: 1 })
        .expect(403);
      expect(denied.body.error.code).toBe("PERMISSION_DENIED");
    }
  });
});
