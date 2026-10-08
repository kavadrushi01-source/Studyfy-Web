import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
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
      schoolName: `Biometric School ${uid()}`,
      adminName: "Biometric Admin",
      adminEmail: `biometric-admin-${uid()}@example.com`,
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
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: `S${uid()}` } });
  return section.id;
}

async function makePupil(schoolId: string, sectionId: string): Promise<string> {
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: `biometric-pupil-${uid()}@example.com`,
      passwordHash: "x",
      name: "Biometric Pupil",
    },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  return student.id;
}

async function enrollDevice(
  schoolId: string,
  adminToken: string,
  name = "Gate Terminal 1",
): Promise<{ deviceId: string; deviceKey: string }> {
  const res = await request(app)
    .post(`/api/v1/schools/${schoolId}/biometric/devices`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name, location: "Main gate" })
    .expect(201);
  return {
    deviceId: res.body.data.device.id as string,
    deviceKey: res.body.data.deviceKey as string,
  };
}

describe("biometric devices (§7 Phase 3 #21 — key-authed punch import)", () => {
  it("enrolls a device showing the key once and storing only its hash", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const { deviceId, deviceKey } = await enrollDevice(schoolId, adminToken);
    expect(deviceKey.startsWith("bio_")).toBe(true);

    const row = await prisma.biometricDevice.findUnique({ where: { id: deviceId } });
    expect(row?.keyHash).toBeTruthy();
    expect(row?.keyHash).not.toContain(deviceKey);
    expect(row?.keyHash).not.toBe(deviceKey);

    const list = await request(app)
      .get(`/api/v1/schools/${schoolId}/biometric/devices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.data.devices).toHaveLength(1);
    expect(list.body.data.devices[0]).not.toHaveProperty("keyHash");
    expect(list.body.data.devices[0]).not.toHaveProperty("deviceKey");
  });

  it("maps pupils and marks PRESENT rows from punches, reporting unknowns", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const pupil = await makePupil(schoolId, sectionId);
    const { deviceKey } = await enrollDevice(schoolId, adminToken);

    await request(app)
      .post(`/api/v1/schools/${schoolId}/biometric/mappings`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ studentId: pupil, deviceUserId: "BIO-001" })
      .expect(200);

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance/device-punches`)
      .set("x-device-key", deviceKey)
      .send({
        punches: [
          { deviceUserId: "BIO-001", timestamp: "2026-10-07T04:30:00Z" },
          { deviceUserId: "BIO-001", timestamp: "2026-10-07T04:35:00Z" },
          { deviceUserId: "GHOST-9", timestamp: "2026-10-07T04:30:00Z" },
        ],
      })
      .expect(200);
    // Same pupil same day re-taps once; the stranger is reported, not guessed.
    expect(res.body.data.marked).toBe(1);
    expect(res.body.data.unknown).toEqual(["GHOST-9"]);

    const rows = await prisma.attendance.findMany({ where: { schoolId, studentId: pupil } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("PRESENT");
    expect(rows[0]?.date.toISOString().slice(0, 10)).toBe("2026-10-07");
  });

  it("derives the attendance day in the school timezone, not UTC", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const pupil = await makePupil(schoolId, sectionId);
    const { deviceKey } = await enrollDevice(schoolId, adminToken);
    await request(app)
      .post(`/api/v1/schools/${schoolId}/biometric/mappings`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ studentId: pupil, deviceUserId: "BIO-002" })
      .expect(200);

    // 18:30 UTC = 00:00 next day in Asia/Kolkata — the row belongs to Oct 8.
    await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance/device-punches`)
      .set("x-device-key", deviceKey)
      .send({ punches: [{ deviceUserId: "BIO-002", timestamp: "2026-10-07T18:30:00Z" }] })
      .expect(200);
    const rows = await prisma.attendance.findMany({ where: { schoolId, studentId: pupil } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date.toISOString().slice(0, 10)).toBe("2026-10-08");
  });

  it("refuses bad keys, suspended devices, cross-school keys, and non-admin enrollment", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const other = await registerSchool();
    const { deviceId, deviceKey } = await enrollDevice(schoolId, adminToken);
    const punchUrl = (school: string) => `/api/v1/schools/${school}/attendance/device-punches`;
    const body = { punches: [{ deviceUserId: "X", timestamp: "2026-10-07T04:30:00Z" }] };

    await request(app).post(punchUrl(schoolId)).send(body).expect(401);
    await request(app).post(punchUrl(schoolId)).set("x-device-key", "bio_wrong").send(body).expect(401);
    // Another school's URL with this school's key: 403, never re-scoped.
    await request(app).post(punchUrl(other.schoolId)).set("x-device-key", deviceKey).send(body).expect(403);

    await request(app)
      .patch(`/api/v1/schools/${schoolId}/biometric/devices/${deviceId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200);
    await request(app).post(punchUrl(schoolId)).set("x-device-key", deviceKey).send(body).expect(401);

    // A teacher holds attendance.mark but enrollment is admin-only.
    const teacherRole = await prisma.role.findUnique({ where: { name: "TEACHER" } });
    const teacherEmail = `biometric-teacher-${uid()}@example.com`;
    const teacherPassword = "teacher-pass-123";
    await prisma.user.create({
      data: {
        schoolId,
        roleId: teacherRole!.id,
        email: teacherEmail,
        passwordHash: await bcrypt.hash(teacherPassword, 4),
        name: "Biometric Teacher",
      },
    });
    const teacherLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: teacherEmail, password: teacherPassword, schoolSlug: slug })
      .expect(200);
    await request(app)
      .post(`/api/v1/schools/${schoolId}/biometric/devices`)
      .set("Authorization", `Bearer ${teacherLogin.body.data.accessToken as string}`)
      .send({ name: "Teacher Terminal" })
      .expect(403);

    // Stranger admin on the wrong school URL (tenant gate first).
    await request(app)
      .post(`/api/v1/schools/${other.schoolId}/biometric/devices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Sneaky Terminal" })
      .expect(403);
  });

  it("rejects duplicate device IDs across pupils and validates bodies", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const s1 = await makePupil(schoolId, sectionId);
    const s2 = await makePupil(schoolId, sectionId);
    const auth = { Authorization: `Bearer ${adminToken}` };
    const mapUrl = `/api/v1/schools/${schoolId}/biometric/mappings`;

    await request(app).post(mapUrl).set(auth).send({ studentId: s1, deviceUserId: "DUP-1" }).expect(200);
    const clash = await request(app).post(mapUrl).set(auth).send({ studentId: s2, deviceUserId: "DUP-1" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("DEVICE_ID_TAKEN");

    // Unmap with null, then the ID is free.
    await request(app).post(mapUrl).set(auth).send({ studentId: s1, deviceUserId: null }).expect(200);
    await request(app).post(mapUrl).set(auth).send({ studentId: s2, deviceUserId: "DUP-1" }).expect(200);

    await request(app).post(mapUrl).set(auth).send({}).expect(400);
    const { deviceKey } = await enrollDevice(schoolId, adminToken);
    await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance/device-punches`)
      .set("x-device-key", deviceKey)
      .send({ punches: [] })
      .expect(400);
    await request(app)
      .post(`/api/v1/schools/${schoolId}/attendance/device-punches`)
      .set("x-device-key", deviceKey)
      .send({ punches: [{ deviceUserId: "X", timestamp: "not-a-date" }] })
      .expect(400);
  });
});
