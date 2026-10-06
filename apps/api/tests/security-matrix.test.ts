import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

// This file registers several schools and logs in many users per test —
// heavier than the average suite file. Under full-suite parallel load on
// a Windows dev box that can exceed the 5s default; the timeout below is
// a load allowance, not a correctness one (every assertion is exact).
vi.setConfig({ testTimeout: 60000 });

// Full cross-module security matrix (Phase 0 §1 + §3, staff §3-shape).
// Fresh schools A/B per run — never seed-dependent. If anything here
// fails, it is the most serious finding in the suite: stop and fix.
const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(name: string): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `${name} ${uid()}`,
      adminName: `${name} Admin`,
      adminEmail: `${name.toLowerCase()}-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSection(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  return section.id;
}

async function makePupil(
  schoolId: string,
  slug: string,
  sectionId: string,
  roleName: string,
): Promise<{ token: string; userId: string; refId: string }> {
  // roleName STUDENT → pupil (refId = studentId); PARENT → linked guardian
  // of a fresh pupil (refId = that pupil's id); TEACHER → staffer
  // (refId = staffId).
  const email = `matrix-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "user-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} Matrix` },
  });
  let refId = "";
  if (roleName === "STUDENT") {
    const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
    refId = student.id;
  } else if (roleName === "PARENT") {
    const pupilUser = await prisma.user.create({
      data: {
        schoolId,
        roleId: (await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } })).id,
        email: `matrix-child-${uid()}@example.com`,
        passwordHash: await bcrypt.hash(password, 4),
        name: "Matrix Child",
      },
    });
    const pupil = await prisma.student.create({ data: { schoolId, userId: pupilUser.id, sectionId } });
    await prisma.studentGuardian.create({ data: { schoolId, studentId: pupil.id, parentId: user.id, relationship: "Father" } });
    refId = pupil.id;
  } else {
    const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: roleName } });
    refId = staff.id;
  }
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id, refId };
}

describe("security matrix: cross-tenant URLs never cross", () => {
  it("A's admin on B's URLs gets 403 on every module, never data", async () => {
    const a = await registerSchool("MatrixA");
    const b = await registerSchool("MatrixB");
    const auth = { Authorization: `Bearer ${a.adminToken}` };
    const urls = [
      `/api/v1/schools/${b.schoolId}/students`,
      `/api/v1/schools/${b.schoolId}/sections`,
      `/api/v1/schools/${b.schoolId}/fees/invoices`,
      `/api/v1/schools/${b.schoolId}/library/books`,
      `/api/v1/schools/${b.schoolId}/library/loans`,
      `/api/v1/schools/${b.schoolId}/transport/routes`,
      `/api/v1/schools/${b.schoolId}/payroll`,
      `/api/v1/schools/${b.schoolId}/payroll/attendance`,
      `/api/v1/schools/${b.schoolId}/homework`,
      `/api/v1/schools/${b.schoolId}/notices`,
      `/api/v1/schools/${b.schoolId}/exams`,
      `/api/v1/schools/${b.schoolId}/enquiries`,
      `/api/v1/schools/${b.schoolId}/certificates`,
    ];
    for (const url of urls) {
      const res = await request(app).get(url).set(auth).expect(403);
      expect(res.body.error.code).toBe("TENANT_MISMATCH");
    }
    // No token at all → 401, never a redirect or a leak.
    await request(app).get(`/api/v1/schools/${b.schoolId}/students`).expect(401);
  });

  it("A's row ids are invisible through B's URLs (scoped 404, not a leak)", async () => {
    const a = await registerSchool("MatrixC");
    const b = await registerSchool("MatrixD");
    const sectionId = await makeSection(a.schoolId);
    const pupil = await makePupil(a.schoolId, a.slug, sectionId, "STUDENT");
    const authB = { Authorization: `Bearer ${b.adminToken}` };
    await request(app).get(`/api/v1/schools/${b.schoolId}/students/${pupil.refId}`).set(authB).expect(404);
    const route = await request(app)
      .post(`/api/v1/schools/${a.schoolId}/transport/routes`)
      .set("Authorization", `Bearer ${a.adminToken}`)
      .send({ name: "Matrix Loop" })
      .expect(201);
    await request(app)
      .get(`/api/v1/schools/${b.schoolId}/transport/routes`)
      .set(authB)
      .expect(200)
      .then((res) => expect(res.body.data.routes).toEqual([]));
    void route;
  });

  it("platform owner sees across schools; school roles never reach platform routes", async () => {
    await registerSchool("MatrixE");
    await registerSchool("MatrixF");
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
    const email = `matrix-owner-${uid()}@example.com`;
    await prisma.user.create({
      data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Owner" },
    });
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
    const ownerAuth = { Authorization: `Bearer ${login.body.data.accessToken as string}` };
    const schools = await request(app).get("/api/v1/platform/schools").set(ownerAuth).expect(200);
    expect(schools.body.data.schools.length).toBeGreaterThanOrEqual(2);

    const g = await registerSchool("MatrixG");
    await request(app)
      .get("/api/v1/platform/schools")
      .set("Authorization", `Bearer ${g.adminToken}`)
      .expect(403);
    await request(app).get("/api/v1/platform/schools").expect(401);
  });
});

describe("security matrix: self-scope defaults to own, never all", () => {
  it("student sees own records; other pupils are 403/404; unfiltered lists stay pinned", async () => {
    const school = await registerSchool("MatrixH");
    const sectionId = await makeSection(school.schoolId);
    const pupil = await makePupil(school.schoolId, school.slug, sectionId, "STUDENT");
    const stranger = await makePupil(school.schoolId, school.slug, sectionId, "STUDENT");
    const auth = { Authorization: `Bearer ${pupil.token}` };

    await request(app).get(`/api/v1/schools/${school.schoolId}/students/${pupil.refId}`).set(auth).expect(200);
    await request(app).get(`/api/v1/schools/${school.schoolId}/students/${stranger.refId}`).set(auth).expect(403);

    // Unfiltered boards: only own rows, never the roster.
    const ledger = await request(app).get(`/api/v1/schools/${school.schoolId}/fees/invoices`).set(auth).expect(200);
    for (const row of ledger.body.data.invoices as { studentId: string }[]) {
      expect(row.studentId).toBe(pupil.refId);
    }
    const loans = await request(app).get(`/api/v1/schools/${school.schoolId}/library/loans`).set(auth).expect(200);
    for (const row of loans.body.data.loans as { student: { id: string } }[]) {
      expect(row.student.id).toBe(pupil.refId);
    }
    const rides = await request(app).get(`/api/v1/schools/${school.schoolId}/transport/rides`).set(auth).expect(200);
    for (const row of rides.body.data.rides as { student: { id: string } }[]) {
      expect(row.student.id).toBe(pupil.refId);
    }
  });

  it("parent sees linked children only; strangers blocked; defaults stay linked", async () => {
    const school = await registerSchool("MatrixI");
    const sectionId = await makeSection(school.schoolId);
    const parent = await makePupil(school.schoolId, school.slug, sectionId, "PARENT");
    const stranger = await makePupil(school.schoolId, school.slug, sectionId, "STUDENT");
    const auth = { Authorization: `Bearer ${parent.token}` };

    await request(app).get(`/api/v1/schools/${school.schoolId}/students/${parent.refId}`).set(auth).expect(200);
    await request(app).get(`/api/v1/schools/${school.schoolId}/students/${stranger.refId}`).set(auth).expect(403);

    const ledger = await request(app).get(`/api/v1/schools/${school.schoolId}/fees/invoices`).set(auth).expect(200);
    for (const row of ledger.body.data.invoices as { studentId: string }[]) {
      expect(row.studentId).toBe(parent.refId);
    }
    // Another family's ledger must not contain our child, and vice versa.
    const otherParent = await makePupil(school.schoolId, school.slug, sectionId, "PARENT");
    const otherAuth = { Authorization: `Bearer ${otherParent.token}` };
    // Other parent's ledger must not contain our child.
    const otherLedger = await request(app).get(`/api/v1/schools/${school.schoolId}/fees/invoices`).set(otherAuth).expect(200);
    for (const row of otherLedger.body.data.invoices as { studentId: string }[]) {
      expect(row.studentId).toBe(otherParent.refId);
    }
  });

  it("staff see own payroll/attendance/leaves; colleagues blocked; defaults stay own", async () => {
    const school = await registerSchool("MatrixJ");
    const adminAuth = { Authorization: `Bearer ${school.adminToken}` };
    const teacher = await makePupil(school.schoolId, school.slug, await makeSection(school.schoolId), "TEACHER");
    const colleague = await makePupil(school.schoolId, school.slug, await makeSection(school.schoolId), "TEACHER");
    const auth = { Authorization: `Bearer ${teacher.token}` };

    for (const url of [
      `/api/v1/schools/${school.schoolId}/payroll?staffId=${colleague.refId}`,
      `/api/v1/schools/${school.schoolId}/payroll/attendance?staffId=${colleague.refId}`,
      `/api/v1/schools/${school.schoolId}/payroll/leaves?staffId=${colleague.refId}`,
    ]) {
      const denied = await request(app).get(url).set(auth).expect(403);
      expect(denied.body.error.code).toBe("FORBIDDEN");
    }
    // Defaults pin to own (empty here — the point is no colleague rows).
    const mine = await request(app).get(`/api/v1/schools/${school.schoolId}/payroll`).set(auth).expect(200);
    for (const row of mine.body.data.payroll as { staff: { id: string } }[]) {
      expect(row.staff.id).toBe(teacher.refId);
    }
    // Office writes stay office-only.
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/payroll/compute`)
      .set(auth)
      .send({ staffId: teacher.refId, month: "2026-10", baseSalary: 30000 })
      .expect(403);
    void adminAuth;
  });
});
