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
      schoolName: `CRM School ${uid()}`,
      adminName: "CRM Admin",
      adminEmail: `crm-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeEnquiry(schoolId: string, name: string): Promise<string> {
  const row = await prisma.enquiry.create({
    data: { schoolId, name, phone: `90000${uid().slice(0, 5)}`, message: "Admission for Grade 1." },
  });
  return row.id;
}

async function loginAsTeacher(schoolId: string, slug: string): Promise<string> {
  const email = `crm-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const bcrypt = await import("bcryptjs");
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "CRM Teacher" },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  const ok = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return ok.body.data.accessToken as string;
}

describe("Admission CRM pipeline (§7 Phase 2 #16)", () => {
  it("lists with totals, filters by stage, searches by name", async () => {
    const { schoolId, adminToken } = await registerSchool();
    await makeEnquiry(schoolId, `Aarav Prospect ${uid()}`);
    await makeEnquiry(schoolId, `Diya Prospect ${uid()}`);

    const list = await request(app)
      .get(`/api/v1/schools/${schoolId}/enquiries`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.data.total).toBe(2);
    expect(list.body.data.totals).toMatchObject({ NEW: 2 });

    const search = await request(app)
      .get(`/api/v1/schools/${schoolId}/enquiries?search=Aarav Prospect`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(search.body.data.total).toBe(1);

    const empty = await request(app)
      .get(`/api/v1/schools/${schoolId}/enquiries?status=ADMITTED`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(empty.body.data.total).toBe(0);
  });

  it("moves stages with an auto-note, assigns, unassigns, takes notes", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const id = await makeEnquiry(schoolId, `Pipeline Kid ${uid()}`);
    const teacherToken = await loginAsTeacher(schoolId, slug);
    const teacher = await prisma.user.findFirstOrThrow({ where: { schoolId, email: { contains: "crm-teacher-" } } });

    const moved = await request(app)
      .patch(`/api/v1/schools/${schoolId}/enquiries/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "CONTACTED", assigneeId: teacher.id })
      .expect(200);
    expect(moved.body.data.enquiry.status).toBe("CONTACTED");
    expect(moved.body.data.enquiry.assignee.name).toBe("CRM Teacher");

    const noted = await request(app)
      .post(`/api/v1/schools/${schoolId}/enquiries/${id}/notes`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ body: "Called — parents visiting Saturday." })
      .expect(201);
    expect(noted.body.data.note.body).toContain("Saturday");

    const detail = await request(app)
      .get(`/api/v1/schools/${schoolId}/enquiries/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const bodies = (detail.body.data.enquiry.notes as { body: string }[]).map((n) => n.body);
    expect(bodies.some((b) => b.includes("NEW to CONTACTED"))).toBe(true);
    expect(bodies.some((b) => b.includes("Saturday"))).toBe(true);

    // Rejected stage + unassign back to the queue.
    await request(app)
      .patch(`/api/v1/schools/${schoolId}/enquiries/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "REJECTED", assigneeId: null })
      .expect(200);
    expect(teacherToken.length).toBeGreaterThan(0);
  });

  it("validates stages, assignees, and cross-tenant access", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const id = await makeEnquiry(schoolA.schoolId, `Guarded Kid ${uid()}`);

    await request(app)
      .patch(`/api/v1/schools/${schoolA.schoolId}/enquiries/${id}`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ status: "GRADUATED" })
      .expect(400);

    await request(app)
      .patch(`/api/v1/schools/${schoolA.schoolId}/enquiries/${id}`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({})
      .expect(400);

    const stranger = await request(app)
      .patch(`/api/v1/schools/${schoolA.schoolId}/enquiries/${id}`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ assigneeId: "cmu00000000000000000000000" })
      .expect(404);
    expect(stranger.body.error.code).toBe("ASSIGNEE_NOT_FOUND");

    // Stranger school sees nothing (tenant scope → 404, never a leak).
    await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/enquiries/${id}`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(404);
    const crossList = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/enquiries`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(200);
    expect(crossList.body.data.total).toBe(0);

    // Teacher holds no crm key at all.
    const teacherToken = await loginAsTeacher(schoolA.schoolId, schoolA.slug);
    const denied = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/enquiries`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(403);
    expect(denied.body.error.code).toBe("PERMISSION_DENIED");
  });
});
