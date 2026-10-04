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

async function makeStaff(
  schoolId: string,
  slug: string,
  roleName: string,
  name: string,
): Promise<{ token: string; staffId: string }> {
  const email = `payroll-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "user-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: roleName === "TEACHER" ? "Teacher" : "Accountant" } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, staffId: staff.id };
}

describe("Payroll (§7 Phase 2 #15, basic)", () => {
  it("sets salaries, generates a month once, pays with payer recorded", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const auth = { Authorization: `Bearer ${adminToken}` };
    const teacher = await makeStaff(schoolId, (await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })).slug, "TEACHER", "Payroll Teacher");

    const set = await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/salaries`)
      .set(auth)
      .send({ staffId: teacher.staffId, monthlyAmount: "45000.50" })
      .expect(201);
    expect(set.body.data.salary.monthlyAmount).toBe("45000.50");

    const gen = await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/generate`)
      .set(auth)
      .send({ month: "2026-10" })
      .expect(201);
    expect(gen.body.data.generated).toBe(1);

    // Regenerating fills gaps only — never duplicates.
    const regen = await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/generate`)
      .set(auth)
      .send({ month: "2026-10" })
      .expect(201);
    expect(regen.body.data.generated).toBe(0);
    expect(regen.body.data.total).toBe(1);

    const list = await request(app)
      .get(`/api/v1/schools/${schoolId}/payroll/payments?month=2026-10`)
      .set(auth)
      .expect(200);
    const row = list.body.data.payments[0] as { id: string; amount: string; status: string };
    expect(row.amount).toBe("45000.50");
    expect(row.status).toBe("PENDING");

    const paid = await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/payments/${row.id}/pay`)
      .set(auth)
      .expect(200);
    expect(paid.body.data.payment.status).toBe("PAID");
    expect(paid.body.data.payment.payer.name).toBe("Payroll Admin");

    const twice = await request(app)
      .post(`/api/v1/schools/${schoolId}/payroll/payments/${row.id}/pay`)
      .set(auth)
      .expect(409);
    expect(twice.body.error.code).toBe("ALREADY_PAID");
  });

  it("pins staff to own slips and enforces roles + tenancy", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const teacher = await makeStaff(schoolA.schoolId, schoolA.slug, "TEACHER", "Slip Teacher");
    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/payroll/salaries`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ staffId: teacher.staffId, monthlyAmount: "30000" })
      .expect(201);
    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/payroll/generate`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ month: "2026-11" })
      .expect(201);

    // The teacher sees exactly one row: their own November slip.
    const mine = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/payroll/payments`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(200);
    expect(mine.body.data.total).toBe(1);
    expect(mine.body.data.payments[0].staff.name).toBe("Slip Teacher");

    // Asking for another staffer's rows is refused.
    const other = await makeStaff(schoolA.schoolId, schoolA.slug, "TEACHER", "Other Teacher");
    await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/payroll/payments?staffId=${other.staffId}`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(403);

    // Stranger school sees nothing (tenant scope, never a leak).
    const cross = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/payroll/payments`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(200);
    expect(cross.body.data.total).toBe(0);

    // Pupils hold no payroll key at all.
    const pupilRole = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
    const pupilEmail = `payroll-pupil-${uid()}@example.com`;
    await prisma.user.create({
      data: { schoolId: schoolA.schoolId, roleId: pupilRole.id, email: pupilEmail, passwordHash: await bcrypt.hash("pupil-pass-123", 4), name: "Payroll Pupil" },
    });
    const pupilLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: pupilEmail, password: "pupil-pass-123", schoolSlug: schoolA.slug })
      .expect(200);
    const denied = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/payroll/payments`)
      .set("Authorization", `Bearer ${pupilLogin.body.data.accessToken as string}`)
      .expect(403);
    expect(denied.body.error.code).toBe("PERMISSION_DENIED");
  });
});
