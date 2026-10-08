import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

const SYNC_URL = "/api/v1/devices/attendance-sync";

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

async function mapTag(schoolId: string, adminToken: string, studentId: string, tag: string): Promise<void> {
  await request(app)
    .post(`/api/v1/schools/${schoolId}/biometric/mappings`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ studentId, deviceUserId: tag })
    .expect(200);
}

describe("devices/attendance-sync (§7 Phase 3 #21, §13.4 third path)", () => {
  it("enrolls a device showing the key once and storing only its hash", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const { deviceId, deviceKey } = await enrollDevice(schoolId, adminToken);
    expect(deviceKey.startsWith("bio_")).toBe(true);

    const row = await prisma.biometricDevice.findUnique({ where: { id: deviceId } });
    expect(row?.apiKeyHash).toBeTruthy();
    expect(row?.apiKeyHash).not.toContain(deviceKey);
    expect(row?.apiKeyHash).not.toBe(deviceKey);

    const list = await request(app)
      .get(`/api/v1/schools/${schoolId}/biometric/devices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.data.devices).toHaveLength(1);
    expect(list.body.data.devices[0]).not.toHaveProperty("apiKeyHash");
    expect(list.body.data.devices[0]).not.toHaveProperty("deviceKey");
  });

  it("syncs PRESENT and ABSENT events like manual marking, reporting unknown tags", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const pupil = await makePupil(schoolId, sectionId);
    const { deviceId, deviceKey } = await enrollDevice(schoolId, adminToken);
    await mapTag(schoolId, adminToken, pupil, "TAG-001");

    const res = await request(app)
      .post(SYNC_URL)
      .set("x-device-key", deviceKey)
      .send({
        events: [
          { tag: "TAG-001", timestamp: "2026-10-07T04:30:00Z", status: "PRESENT" },
          { tag: "TAG-001", timestamp: "2026-10-07T04:35:00Z", status: "ABSENT" },
          { tag: "GHOST-9", timestamp: "2026-10-07T04:30:00Z" },
        ],
      })
      .expect(200);
    // Last event per pupil per day wins (exit tap after entry tap); the
    // stranger is reported, never guessed.
    expect(res.body.data.marked).toBe(1);
    expect(res.body.data.unknown).toEqual(["GHOST-9"]);

    const rows = await prisma.attendance.findMany({ where: { schoolId, studentId: pupil } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("ABSENT");
    expect(rows[0]?.date.toISOString().slice(0, 10)).toBe("2026-10-07");

    const device = await prisma.biometricDevice.findUnique({ where: { id: deviceId } });
    expect(device?.lastSyncAt).not.toBeNull();
  });

  it("derives the attendance day in the school timezone, not UTC", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const pupil = await makePupil(schoolId, sectionId);
    const { deviceKey } = await enrollDevice(schoolId, adminToken);
    await mapTag(schoolId, adminToken, pupil, "TAG-002");

    // 18:30 UTC = 00:00 next day in Asia/Kolkata — the row belongs to Oct 8.
    await request(app)
      .post(SYNC_URL)
      .set("x-device-key", deviceKey)
      .send({ events: [{ tag: "TAG-002", timestamp: "2026-10-07T18:30:00Z" }] })
      .expect(200);
    const rows = await prisma.attendance.findMany({ where: { schoolId, studentId: pupil } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date.toISOString().slice(0, 10)).toBe("2026-10-08");
  });

  it("refuses missing, wrong, and suspended keys with 401", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const { deviceId, deviceKey } = await enrollDevice(schoolId, adminToken);
    const body = { events: [{ tag: "X", timestamp: "2026-10-07T04:30:00Z" }] };

    await request(app).post(SYNC_URL).send(body).expect(401);
    await request(app).post(SYNC_URL).set("x-device-key", "bio_wrong").send(body).expect(401);

    await request(app)
      .patch(`/api/v1/schools/${schoolId}/biometric/devices/${deviceId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: false })
      .expect(200);
    await request(app).post(SYNC_URL).set("x-device-key", deviceKey).send(body).expect(401);
  });

  it("a valid key for School A cannot write School B's attendance", async () => {
    // The route carries no school segment at all: the ONLY school in play
    // is the key's own. Same tag enrolled in both schools resolves to the
    // key owner's pupil; the other school gains no rows.
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const sectionA = await makeSection(schoolA.schoolId);
    const sectionB = await makeSection(schoolB.schoolId);
    const pupilA = await makePupil(schoolA.schoolId, sectionA);
    const pupilB = await makePupil(schoolB.schoolId, sectionB);
    const { deviceKey } = await enrollDevice(schoolA.schoolId, schoolA.adminToken);
    await mapTag(schoolA.schoolId, schoolA.adminToken, pupilA, "SHARED-TAG");
    await mapTag(schoolB.schoolId, schoolB.adminToken, pupilB, "SHARED-TAG");

    await request(app)
      .post(SYNC_URL)
      .set("x-device-key", deviceKey)
      .send({ events: [{ tag: "SHARED-TAG", timestamp: "2026-10-07T04:30:00Z" }] })
      .expect(200);

    expect(await prisma.attendance.count({ where: { schoolId: schoolA.schoolId } })).toBe(1);
    expect(await prisma.attendance.count({ where: { schoolId: schoolB.schoolId } })).toBe(0);
  });

  it("refuses non-admin enrollment and validates bodies", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
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

    const other = await registerSchool();
    await request(app)
      .post(`/api/v1/schools/${other.schoolId}/biometric/devices`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Sneaky Terminal" })
      .expect(403);

    const sectionId = await makeSection(schoolId);
    const s1 = await makePupil(schoolId, sectionId);
    const s2 = await makePupil(schoolId, sectionId);
    const auth = { Authorization: `Bearer ${adminToken}` };
    const mapUrl = `/api/v1/schools/${schoolId}/biometric/mappings`;
    await request(app).post(mapUrl).set(auth).send({ studentId: s1, deviceUserId: "DUP-1" }).expect(200);
    const clash = await request(app).post(mapUrl).set(auth).send({ studentId: s2, deviceUserId: "DUP-1" });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("DEVICE_ID_TAKEN");

    const { deviceKey } = await enrollDevice(schoolId, adminToken);
    await request(app).post(SYNC_URL).set("x-device-key", deviceKey).send({ events: [] }).expect(400);
    await request(app)
      .post(SYNC_URL)
      .set("x-device-key", deviceKey)
      .send({ events: [{ tag: "X", timestamp: "not-a-date" }] })
      .expect(400);
    await request(app)
      .post(SYNC_URL)
      .set("x-device-key", deviceKey)
      .send({ events: [{ tag: "X", timestamp: "2026-10-07T04:30:00Z", status: "SLEEPING" }] })
      .expect(400);
  });
});
