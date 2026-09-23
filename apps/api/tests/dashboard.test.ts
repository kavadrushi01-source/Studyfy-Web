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
      schoolName: `Dashboard School ${uid()}`,
      adminName: "Dashboard Admin",
      adminEmail: `dashboard-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeTeacher(schoolId: string, slug: string): Promise<string> {
  const email = `dashboard-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Dashboard Teacher" },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

interface AdminBundle {
  totalStudents: number;
  totalTeachers: number;
  totalClasses: number;
  feeCollection: string;
  growth: { month: string; count: number }[];
  activities: { kind: string; title: string; at: string }[];
  asOf: { day: string; month: string };
}

describe("GET /api/v1/schools/:schoolId/dashboard/admin (§7 Phase 1 #9)", () => {
  it(
    "returns the admin bundle: KPIs, 6-month growth, activities",
    async () => {
      const { schoolId, adminToken } = await registerSchool();
      const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
      const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
      const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
      const pupil = await prisma.user.create({
        data: { schoolId, roleId: studentRole.id, email: `dash-pupil-${uid()}@example.com`, passwordHash: "x", name: "Dash Pupil" },
      });
      await prisma.student.create({ data: { schoolId, userId: pupil.id, sectionId: section.id } });

      const res = await request(app)
        .get(`/api/v1/schools/${schoolId}/dashboard/admin`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const bundle = res.body.data.dashboard as AdminBundle;
      expect(bundle.totalStudents).toBe(1);
      expect(bundle.totalTeachers).toBe(0);
      expect(bundle.totalClasses).toBe(1);
      expect(bundle.feeCollection).toBe("0.00");
      expect(bundle.growth).toHaveLength(6);
      const total = bundle.growth.reduce((sum, p) => sum + p.count, 0);
      expect(total).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(bundle.activities)).toBe(true);
      expect(bundle.asOf.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    },
    30000,
  );

  it(
    "shows a posted notice in the activities feed (write invalidates)",
    async () => {
      const { schoolId, adminToken } = await registerSchool();
      const before = await request(app)
        .get(`/api/v1/schools/${schoolId}/dashboard/admin`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(JSON.stringify(before.body)).not.toContain("Dashboard Feed Notice");

      await request(app)
        .post(`/api/v1/schools/${schoolId}/notices`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Dashboard Feed Notice",
          body: "This notice exists so the dashboard activities feed has something real to show.",
        })
        .expect(201);

      const after = await request(app)
        .get(`/api/v1/schools/${schoolId}/dashboard/admin`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      const feed = (after.body.data.dashboard as AdminBundle).activities;
      expect(feed.some((a) => a.kind === "notice" && a.title === "Dashboard Feed Notice")).toBe(true);
    },
    30000,
  );

  it("denies teachers, strangers, and cross-tenant readers", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const teacherToken = await makeTeacher(schoolA.schoolId, schoolA.slug);

    // Teacher holds no dashboard.read (admin-only until their board lands).
    const denied = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/admin`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(403);
    expect(denied.body.error.code).toBe("PERMISSION_DENIED");

    // B's admin on A's URL: tenant mismatch, never A's numbers.
    const cross = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/admin`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(403);
    expect(cross.body.error.code).toBe("TENANT_MISMATCH");

    await request(app).get(`/api/v1/schools/${schoolA.schoolId}/dashboard/admin`).expect(401);
  }, 30000);
});

describe("GET /api/v1/auth/me", () => {
  it("returns the caller's fresh identity, 401s strangers", async () => {
    const { adminToken } = await registerSchool();
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${adminToken}`).expect(200);
    expect(me.body.data.user.name).toBe("Dashboard Admin");
    expect(me.body.data.user.role).toBe("SCHOOL_ADMIN");
    expect(typeof me.body.data.user.schoolId).toBe("string");

    await request(app).get("/api/v1/auth/me").expect(401);
  });
});
