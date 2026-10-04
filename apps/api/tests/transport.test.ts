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

describe("Transport (§7 Phase 2 #14, founder schema)", () => {
  it("runs routes with JSON stop runs, fleet, and rider assignment", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const auth = { Authorization: `Bearer ${adminToken}` };

    const route = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/routes`)
      .set(auth)
      .send({ name: `Route ${uid()}`, stops: [{ name: "Depot", pickupTime: "07:00" }] })
      .expect(201);
    const routeId = route.body.data.route.id as string;
    expect(route.body.data.route.stops).toEqual([{ name: "Depot", pickupTime: "07:00" }]);

    // Appends land at the end; `at` splices into the run.
    await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/routes/${routeId}/stops`)
      .set(auth)
      .send({ name: "Lakeview", pickupTime: "07:20" })
      .expect(201);
    const mid = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/routes/${routeId}/stops`)
      .set(auth)
      .send({ name: "Market", at: 2, pickupTime: "07:10" })
      .expect(201);
    expect(mid.body.data.stop.index).toBe(1);

    const board = await request(app).get(`/api/v1/schools/${schoolId}/transport/routes`).set(auth).expect(200);
    expect(board.body.data.routes[0].stops.map((s: { name: string }) => s.name)).toEqual(["Depot", "Market", "Lakeview"]);

    // Rename + move a stop by index.
    const moved = await request(app)
      .patch(`/api/v1/schools/${schoolId}/transport/routes/${routeId}/stops/2`)
      .set(auth)
      .send({ at: 1 })
      .expect(200);
    expect(moved.body.data.stop.index).toBe(0);
    const afterMove = await request(app).get(`/api/v1/schools/${schoolId}/transport/routes`).set(auth).expect(200);
    expect(afterMove.body.data.routes[0].stops.map((s: { name: string }) => s.name)).toEqual([
      "Lakeview",
      "Depot",
      "Market",
    ]);

    // Out-of-range positions 404, never 500.
    const missing = await request(app)
      .delete(`/api/v1/schools/${schoolId}/transport/routes/${routeId}/stops/9`)
      .set(auth)
      .expect(404);
    expect(missing.body.error.code).toBe("STOP_NOT_FOUND");

    const vehicle = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/vehicles`)
      .set(auth)
      .send({ registrationNumber: `KA-05-${uid()}`, capacity: 40, driverName: "Driver Dan" })
      .expect(201);
    expect(vehicle.body.data.vehicle.registrationNumber).toContain("KA-05-");

    // Duplicate registration numbers are refused loudly.
    const dupe = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/vehicles`)
      .set(auth)
      .send({
        registrationNumber: vehicle.body.data.vehicle.registrationNumber as string,
        capacity: 30,
        driverName: "Driver Dee",
      })
      .expect(409);
    expect(dupe.body.error.code).toBe("VEHICLE_EXISTS");

    const pupilId = await makePupil(schoolId);
    const assigned = await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/assignments`)
      .set(auth)
      .send({ studentId: pupilId, routeId })
      .expect(201);
    expect(assigned.body.data.assignment.route.stops).toHaveLength(3);

    // Re-assigning the same pupil is idempotent (one ride per pupil).
    await request(app)
      .post(`/api/v1/schools/${schoolId}/transport/assignments`)
      .set(auth)
      .send({ studentId: pupilId, routeId })
      .expect(201);
    const rides = await request(app).get(`/api/v1/schools/${schoolId}/transport/rides`).set(auth).expect(200);
    expect(rides.body.data.rides.filter((r: { student: { id: string } }) => r.student.id === pupilId)).toHaveLength(1);

    // A route with riders aboard refuses removal.
    const blocked = await request(app).delete(`/api/v1/schools/${schoolId}/transport/routes/${routeId}`).set(auth).expect(409);
    expect(blocked.body.error.code).toBe("RIDERS_ASSIGNED");

    // Unassign, then the route removes cleanly.
    await request(app).delete(`/api/v1/schools/${schoolId}/transport/assignments/${pupilId}`).set(auth).expect(200);
    await request(app).delete(`/api/v1/schools/${schoolId}/transport/routes/${routeId}`).set(auth).expect(200);
  });

  it("pins pupils to their own ride and enforces roles + tenancy", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const route = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/transport/routes`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ name: "Loop", stops: [{ name: "Gate" }] })
      .expect(201);
    const routeId = route.body.data.route.id as string;
    const pupilId = await makePupil(schoolA.schoolId);
    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/transport/assignments`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ studentId: pupilId, routeId })
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
      .send({ studentId: pupilId, routeId })
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
