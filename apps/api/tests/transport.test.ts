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
      schoolName: `Transport School ${uid()}`,
      adminName: "Transport Admin",
      adminEmail: `transport-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makePupil(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: `transport-pupil-${uid()}@example.com`,
      passwordHash: await bcrypt.hash("pupil-pass-123", 4),
      name: "Transport Pupil",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId: section.id } });
  return student.id;
}

async function loginAs(schoolId: string, slug: string, roleName: string): Promise<string> {
  const email = `transport-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "user-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} User` },
  });
  if (roleName === "TEACHER") {
    await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  }
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

describe("Transport (§7 Phase 2 #14)", () => {
  it("runs routes, ordered stops, vehicles, and rider assignment", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const auth = { Authorization: `Bearer ${adminToken}` };

    const route = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/routes`)
      .set(auth)
      .send({ name: `Route ${uid()}`, description: "North loop" })
      .expect(201);
    const routeId = route.body.data.route.id as string;

    // Stops land dense 1..N in run order, explicit positions splice in.
    const s1 = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/routes/${routeId}/stops`)
      .set(auth)
      .send({ name: "Depot", pickupTime: "07:00" })
      .expect(201);
    const s3 = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/routes/${routeId}/stops`)
      .set(auth)
      .send({ name: "Lakeview", pickupTime: "07:20" })
      .expect(201);
    const s2 = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/routes/${routeId}/stops`)
      .set(auth)
      .send({ name: "Market", stopOrder: 2, pickupTime: "07:10" })
      .expect(201);
    expect(s2.body.data.stop.stopOrder).toBe(2);
    void s1;
    void s3;

    const board = await request(app)
      .get(`/api/v1/schools/${schoolId}/transport/routes`)
      .set(auth)
      .expect(200);
    expect(board.body.data.routes[0].stops.map((s: { name: string }) => s.name)).toEqual(["Depot", "Market", "Lakeview"]);

    const vehicle = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/vehicles`)
      .set(auth)
      .send({ number: "KA-05-1234", capacity: 40, driverName: "Driver Dan", routeId })
      .expect(201);
    expect(vehicle.body.data.vehicle.routeId).toBe(routeId);

    const pupilId = await makePupil(schoolId);
    const assigned = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/assignments`)
      .set(auth)
      .send({ studentId: pupilId, routeId, stopId: s2.body.data.stop.id as string })
      .expect(201);
    expect(assigned.body.data.assignment.stop.name).toBe("Market");

    // Re-assigning moves the rider (one ride per pupil, no duplicates).
    const moved = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/assignments`)
      .set(auth)
      .send({ studentId: pupilId, routeId, stopId: s1.body.data.stop.id as string })
      .expect(201);
    expect(moved.body.data.assignment.stop.name).toBe("Depot");

    // Stop with a rider aboard refuses removal.
    const blocked = await request(app)
      .delete(`/api/v1/schools/${schoolId}/transport/stops/${s1.body.data.stop.id as string}`)
      .set(auth)
      .expect(409);
    expect(blocked.body.error.code).toBe("RIDERS_ASSIGNED");
  });

  it("pins pupils to their own ride and enforces roles + tenancy", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const route = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/transport/routes`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ name: "Loop" })
      .expect(201);
    const routeId = route.body.data.route.id as string;
    const stop = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/transport/routes/${routeId}/stops`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ name: "Gate" })
      .expect(201);
    const pupilId = await makePupil(schoolA.schoolId);
    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/transport/assignments`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ studentId: pupilId, routeId, stopId: stop.body.data.stop.id as string })
      .expect(201);

    // Stranger school sees an empty board (tenant scope, never a leak).
    const cross = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/transport/routes`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(200);
    expect(cross.body.data.routes).toEqual([]);
    await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/transport/assignments`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .send({ studentId: pupilId, routeId, stopId: stop.body.data.stop.id as string })
      .expect(404);

    // Teachers read the board but never run the depot.
    const teacherToken = await loginAs(schoolA.schoolId, schoolA.slug, "TEACHER");
    await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/transport/routes`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);
    const manage = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/transport/routes`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ name: "Nope" })
      .expect(403);
    expect(manage.body.error.code).toBe("PERMISSION_DENIED");
  });
});
