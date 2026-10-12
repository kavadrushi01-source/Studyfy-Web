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

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string; adminEmail: string }> {
  const adminEmail = `users-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Users Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
    adminEmail,
  };
}

async function loginOwner(email?: string): Promise<{ token: string; ownerId: string; email: string }> {
  const ownerEmail = email ?? `users-owner-${uid()}@example.com`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
  const owner = await prisma.user.create({
    data: { schoolId: null, roleId: role.id, email: ownerEmail, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Users Owner" },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email: ownerEmail, password: "owner-pass-123" }).expect(200);
  return { token: res.body.data.accessToken as string, ownerId: owner.id, email: ownerEmail };
}

async function makeTeacher(
  schoolId: string,
  slug: string,
): Promise<{ email: string; password: string; token: string; userId: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
  const email = `users-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Users Teacher" },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { email, password, token: login.body.data.accessToken as string, userId: user.id };
}

describe("platform users list (§7 #23, account administration only)", () => {
  it("shows the owner both schools' accounts with filters, and no academic rows", async () => {
    const schoolA = await registerSchool(`Users List A School ${uid()}`);
    const schoolB = await registerSchool(`Users List B School ${uid()}`);
    const { token } = await loginOwner();

    const all = await request(app).get("/api/v1/platform/users?take=100").set("Authorization", `Bearer ${token}`).expect(200);
    const users = all.body.data.users as { id: string; email: string; role: { name: string }; school: { slug: string } | null }[];
    const emails = users.map((u) => u.email);
    expect(emails).toContain(schoolA.adminEmail);
    expect(emails).toContain(schoolB.adminEmail);
    // Account rows only: no pupil records, marks, fees, or messages.
    for (const user of users) {
      expect(Object.keys(user).sort()).toEqual(["createdAt", "email", "id", "isActive", "name", "role", "school"]);
    }

    const filtered = await request(app)
      .get(`/api/v1/platform/users?schoolId=${schoolA.schoolId}&take=100`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const filteredUsers = filtered.body.data.users as { school: { slug: string } | null }[];
    expect(filteredUsers.length).toBeGreaterThan(0);
    for (const user of filteredUsers) {
      expect(user.school).not.toBeNull();
    }
  });

  it("refuses tenant admins and strangers on all three routes", async () => {
    const school = await registerSchool(`Users Refusal School ${uid()}`);
    const adminAuth = { Authorization: `Bearer ${school.adminToken}` };

    expect((await request(app).get("/api/v1/platform/users").set(adminAuth)).status).toBe(403);
    expect((await request(app).patch("/api/v1/platform/users/whatever").set(adminAuth).send({ isActive: false })).status).toBe(403);
    expect((await request(app).patch("/api/v1/platform/users/whatever/role").set(adminAuth).send({ role: "TEACHER" })).status).toBe(403);
    expect((await request(app).get("/api/v1/platform/users")).status).toBe(401);
  });
});

describe("platform user activation + roles (§13.10 must-list)", () => {
  it("deactivates (login dies), reactivates (login works), both audited with before/after", async () => {
    const school = await registerSchool(`Users Lifecycle School ${uid()}`);
    const { token } = await loginOwner();
    const teacher = await makeTeacher(school.schoolId, school.slug);
    const auth = { Authorization: `Bearer ${token}` };

    await request(app).patch(`/api/v1/platform/users/${teacher.userId}`).set(auth).send({ isActive: false }).expect(200);
    const locked = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: teacher.email, password: teacher.password, schoolSlug: school.slug });
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe("ACCOUNT_DISABLED");

    const deactRows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "USER_DEACTIVATE" } });
    expect(deactRows).toHaveLength(1);
    expect(deactRows[0]?.entityId).toBe(teacher.userId);
    expect(deactRows[0]?.before).toMatchObject({ role: "TEACHER", isActive: true });
    expect(deactRows[0]?.after).toMatchObject({ role: "TEACHER", isActive: false });
    expect(JSON.stringify(deactRows[0])).not.toContain("passwordHash");

    await request(app).patch(`/api/v1/platform/users/${teacher.userId}`).set(auth).send({ isActive: true }).expect(200);
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: teacher.email, password: teacher.password, schoolSlug: school.slug })
      .expect(200);
    const reactRows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "USER_REACTIVATE" } });
    expect(reactRows).toHaveLength(1);
    expect(reactRows[0]?.before).toMatchObject({ isActive: false });
    expect(reactRows[0]?.after).toMatchObject({ isActive: true });
  });

  it("changes roles with before/after names; no-ops stay quiet", async () => {
    const school = await registerSchool(`Users Role School ${uid()}`);
    const { token } = await loginOwner();
    const teacher = await makeTeacher(school.schoolId, school.slug);
    const auth = { Authorization: `Bearer ${token}` };

    const changed = await request(app)
      .patch(`/api/v1/platform/users/${teacher.userId}/role`)
      .set(auth)
      .send({ role: "ACCOUNTANT" })
      .expect(200);
    expect(changed.body.data.user.role).toBe("ACCOUNTANT");
    const rows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "USER_ROLE_CHANGE" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.before).toMatchObject({ role: "TEACHER" });
    expect(rows[0]?.after).toMatchObject({ role: "ACCOUNTANT" });

    const noop = await request(app)
      .patch(`/api/v1/platform/users/${teacher.userId}/role`)
      .set(auth)
      .send({ role: "ACCOUNTANT" })
      .expect(200);
    expect(noop.body.data.unchanged).toBe(true);
    expect(await prisma.auditLog.count({ where: { schoolId: school.schoolId, action: "USER_ROLE_CHANGE" } })).toBe(1);

    const badRole = await request(app)
      .patch(`/api/v1/platform/users/${teacher.userId}/role`)
      .set(auth)
      .send({ role: "HEADMASTER" });
    expect(badRole.status).toBe(400);
    const missing = await request(app).patch("/api/v1/platform/users/nope/role").set(auth).send({ role: "TEACHER" });
    expect(missing.status).toBe(404);
  });

  it("refuses self-harm and every Platform Owner touch, both directions", async () => {
    const school = await registerSchool(`Users Guardrail School ${uid()}`);
    const { token, ownerId } = await loginOwner();
    const teacher = await makeTeacher(school.schoolId, school.slug);
    const auth = { Authorization: `Bearer ${token}` };

    expect((await request(app).patch(`/api/v1/platform/users/${ownerId}`).set(auth).send({ isActive: false })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/platform/users/${ownerId}/role`).set(auth).send({ role: "TEACHER" })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/platform/users/${teacher.userId}/role`).set(auth).send({ role: "PLATFORM_OWNER" })).status).toBe(403);

    // The owner still logs in fine after all refusals (nothing changed).
    await request(app).post("/api/v1/auth/login").send({ email: (await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).email, password: "owner-pass-123" }).expect(200);
  });
});
