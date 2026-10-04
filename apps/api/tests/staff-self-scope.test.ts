import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { scopedPrismaClient } from "../src/lib/prisma-tenant.js";
import { staffSelfScope } from "../src/middleware/selfscope.js";

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

async function makeStaff(
  schoolId: string,
  slug: string,
  roleName: string,
): Promise<{ staffId: string; userId: string; token: string }> {
  const email = `scope-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "user-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} Staffer` },
  });
  const staff = await prisma.staff.create({ data: { schoolId, userId: user.id, designation: roleName } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { staffId: staff.id, userId: user.id, token: login.body.data.accessToken as string };
}

function mockRes(): { res: Partial<Response>; status: number; body: unknown } {
  let status = 0;
  let body: unknown = null;
  const res: Partial<Response> = {
    status: (code: number) => {
      status = code;
      return res as Response;
    },
    json: (payload: unknown) => {
      body = payload;
      return res as Response;
    },
  };
  return { res, get status() { return status; }, get body() { return body; } };
}

describe("StaffSelfScope middleware (§3 shape for STAFF)", () => {
  it("lets the office through unconstrained", async () => {
    const { schoolId } = await registerSchool();
    const db = scopedPrismaClient(prisma, schoolId);
    const adminRow = await db.user.findFirstOrThrow({ where: { role: { name: "SCHOOL_ADMIN" } }, select: { id: true } });
    const req = {
      user: { userId: adminRow.id, role: "SCHOOL_ADMIN", schoolId },
      prisma: db,
      query: {},
    } as unknown as Request;
    const { res } = mockRes();
    const next = vi.fn();
    staffSelfScope(req, res as Response, next);
    await new Promise((r) => setTimeout(r, 200));
    expect(next).toHaveBeenCalled();
    expect(req.staffScope).toBeUndefined();
  });

  it("pins a teacher to their own record and 403s explicit others", async () => {
    const { schoolId, slug } = await registerSchool();
    const teacher = await makeStaff(schoolId, slug, "TEACHER");
    const other = await makeStaff(schoolId, slug, "TEACHER");
    const db = scopedPrismaClient(prisma, schoolId);

    // No filter → pinned to own.
    const plain = { user: { userId: teacher.userId, role: "TEACHER", schoolId }, prisma: db, query: {}, params: {}, body: {} } as unknown as Request;
    const r1 = mockRes();
    const next1 = vi.fn();
    staffSelfScope(plain, r1.res as Response, next1);
    await new Promise((r) => setTimeout(r, 200));
    expect(next1).toHaveBeenCalled();
    expect(plain.staffScope).toEqual({ staffIds: [teacher.staffId] });

    // Explicit other → 403, never next().
    const sneaky = {
      user: { userId: teacher.userId, role: "TEACHER", schoolId },
      prisma: db,
      query: { staffId: other.staffId },
      params: {},
      body: {},
    } as unknown as Request;
    const r2 = mockRes();
    const next2 = vi.fn();
    staffSelfScope(sneaky, r2.res as Response, next2);
    await new Promise((r) => setTimeout(r, 200));
    expect(next2).not.toHaveBeenCalled();
    expect(r2.status).toBe(403);

    // Explicit own → through.
    const own = {
      user: { userId: teacher.userId, role: "TEACHER", schoolId },
      prisma: db,
      query: { staffId: teacher.staffId },
      params: {},
      body: {},
    } as unknown as Request;
    const r3 = mockRes();
    const next3 = vi.fn();
    staffSelfScope(own, r3.res as Response, next3);
    await new Promise((r) => setTimeout(r, 200));
    expect(next3).toHaveBeenCalled();
  });

  it("fail-closes when the login has no staff row", async () => {
    const { schoolId } = await registerSchool();
    const db = scopedPrismaClient(prisma, schoolId);
    // A TEACHER-role user with no staff row must see nothing, not everything.
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
    const orphan = await db.user.create({
      data: { roleId: role.id, email: `scope-orphan-${uid()}@example.com`, passwordHash: "x", name: "Orphan" },
      select: { id: true },
    });
    const req = {
      user: { userId: orphan.id, role: "TEACHER", schoolId },
      prisma: db,
      query: {},
      params: {},
      body: {},
    } as unknown as Request;
    const m = mockRes();
    const next = vi.fn();
    staffSelfScope(req, m.res as Response, next);
    await new Promise((r) => setTimeout(r, 200));
    expect(next).not.toHaveBeenCalled();
    expect(m.status).toBe(403);
  });
});

describe("payroll endpoints under StaffSelfScope", () => {
  it("a teacher sees only their own rows and gets 403 for another staffer", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const auth = { Authorization: `Bearer ${adminToken}` };
    const teacher = await makeStaff(schoolId, slug, "TEACHER");
    const other = await makeStaff(schoolId, slug, "TEACHER");
    for (const s of [teacher, other]) {
      await request(app)
        .post(`/api/v1/schools/${schoolId}/payroll/compute`)
        .set(auth)
        .send({ staffId: s.staffId, month: "2026-10", baseSalary: 30000 })
        .expect(201);
    }

    // Default → own only, never the colleague's.
    const mine = await request(app)
      .get(`/api/v1/schools/${schoolId}/payroll?month=2026-10`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(200);
    expect(mine.body.data.payroll).toHaveLength(1);
    expect(mine.body.data.payroll[0].staff.id).toBe(teacher.staffId);

    // Explicit other → 403 from the middleware, before any service code.
    const denied = await request(app)
      .get(`/api/v1/schools/${schoolId}/payroll?month=2026-10&staffId=${other.staffId}`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");

    // Same pin on attendance and leaves.
    await request(app)
      .get(`/api/v1/schools/${schoolId}/payroll/attendance?staffId=${other.staffId}`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(403);
    await request(app)
      .get(`/api/v1/schools/${schoolId}/payroll/leaves?staffId=${other.staffId}`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .expect(403);
  });
});
