import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { featureForPath } from "../src/middleware/plan-gate.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: name,
      adminName: "Gating Admin",
      adminEmail: `gating-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function setPlan(schoolId: string, plan: "BASIC" | "STANDARD" | "PREMIUM"): Promise<void> {
  // A paying school: status ACTIVE alongside the plan (register leaves
  // TRIAL, and trial status would override the plan tier in effectivePlan).
  await prisma.school.update({ where: { id: schoolId }, data: { plan, subscriptionStatus: "ACTIVE" } });
}

describe("plan-gate path map (§16.1, structural)", () => {
  it("matches with AND without the /api/v1 mount prefix", () => {
    // The shipped-once bug: anchors assumed the mount prefix, but Express
    // strips it before route middleware runs — the whole gate stood open.
    // Both shapes must resolve identically, forever.
    const pairs: [string, "phase2" | "phase3" | null][] = [
      ["/schools/abc/library/books", "phase2"],
      ["/api/v1/schools/abc/library/books", "phase2"],
      ["/schools/abc/transport/routes", "phase2"],
      ["/schools/abc/payroll", "phase2"],
      ["/schools/abc/enquiries", "phase2"],
      ["/schools/abc/certificates", "phase2"],
      ["/schools/abc/fees/invoices/o123/pay-order", "phase2"],
      ["/schools/abc/fees/pay-verify", "phase2"],
      ["/schools/abc/inventory/items", "phase3"],
      ["/schools/abc/biometric/devices", "phase3"],
      ["/schools/abc/analytics/overview", "phase3"],
      ["/schools/abc/attendance/anomalies", "phase3"],
      ["/schools/abc/exams/e1/remarks/generate", "phase3"],
      ["/api/v1/schools/abc/exams/e1/remarks/generate", "phase3"],
      ["/schools/abc/students", null],
      ["/schools/abc/attendance", null],
      ["/schools/abc/fees/invoices", null],
      ["/schools/abc/exams/e1/results", null],
      ["/api/v1/platform/schools", null],
    ];
    for (const [path, expected] of pairs) {
      expect(featureForPath(path)).toBe(expected);
    }
  });
});

describe("feature gating by tier (§16.1, both directions)", () => {
  it("BASIC: Phase 1 open, Phase 2 + Phase 3 refuse with PLAN_UPGRADE_REQUIRED", async () => {
    const school = await registerSchool(`Gating Basic School ${uid()}`);
    await setPlan(school.schoolId, "BASIC");
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const base = `/api/v1/schools/${school.schoolId}`;

    // Phase 1 serves normally.
    await request(app).get(`${base}/students`).set(auth).expect(200);
    // Gated routes refuse BEFORE their handlers (bogus ids still 403, not
    // 404 — the gate runs in tenantMiddleware, ahead of everything).
    const library = await request(app).get(`${base}/library/books`).set(auth);
    expect(library.status).toBe(403);
    expect(library.body.error.code).toBe("PLAN_UPGRADE_REQUIRED");
    await request(app).get(`${base}/inventory/items`).set(auth).expect(403);
    await request(app).get(`${base}/analytics/overview`).set(auth).expect(403);
    await request(app).post(`${base}/biometric/devices`).set(auth).send({ name: "Gated Terminal" }).expect(403);
    await request(app).post(`${base}/exams/nope/remarks/generate`).set(auth).send({ studentId: "x" }).expect(403);
    await request(app).post(`${base}/fees/invoices/nope/pay-order`).set(auth).send({}).expect(403);
  });

  it("STANDARD (and trial): Phase 2 open, Phase 3 refused", async () => {
    const school = await registerSchool(`Gating Standard School ${uid()}`);
    await setPlan(school.schoolId, "STANDARD");
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const base = `/api/v1/schools/${school.schoolId}`;

    await request(app).get(`${base}/library/books`).set(auth).expect(200);
    await request(app).get(`${base}/inventory/items`).set(auth).expect(403);
    await request(app).get(`${base}/analytics/overview`).set(auth).expect(403);

    // Trial rides the Standard tier: same shape, no plan set at all.
    const trial = await registerSchool(`Gating Trial School ${uid()}`);
    const trialAuth = { Authorization: `Bearer ${trial.adminToken}` };
    const trialBase = `/api/v1/schools/${trial.schoolId}`;
    await request(app).get(`${trialBase}/library/books`).set(trialAuth).expect(200);
    await request(app).get(`${trialBase}/inventory/items`).set(trialAuth).expect(403);
  });

  it("PREMIUM: everything serves", async () => {
    const school = await registerSchool(`Gating Premium School ${uid()}`);
    await setPlan(school.schoolId, "PREMIUM");
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const base = `/api/v1/schools/${school.schoolId}`;

    await request(app).get(`${base}/library/books`).set(auth).expect(200);
    await request(app).get(`${base}/inventory/items`).set(auth).expect(200);
    await request(app).get(`${base}/analytics/overview`).set(auth).expect(200);
  });

  it("device sync follows the device school's tier, even after a downgrade", async () => {
    const school = await registerSchool(`Gating Device School ${uid()}`);
    await setPlan(school.schoolId, "PREMIUM");
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const enroll = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/biometric/devices`)
      .set(auth)
      .send({ name: "Gated Terminal" })
      .expect(201);
    const deviceKey = enroll.body.data.deviceKey as string;

    const sync = () =>
      request(app).post("/api/v1/devices/attendance-sync").set("x-device-key", deviceKey).send({ events: [] });
    // Premium: through the gate (empty body is a 400, not a 403 — the gate
    // passed and validation spoke).
    expect((await sync()).status).toBe(400);

    // Downgrade to BASIC: the same key now stops at the gate.
    await setPlan(school.schoolId, "BASIC");
    const denied = await sync();
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("PLAN_UPGRADE_REQUIRED");
  });
});

describe("student caps (§16.1, enforced at admission)", () => {
  it(
    "blocks the 501st pupil on Basic with an upgrade message, admits after upgrade, never deletes on downgrade",
    { timeout: 180000 },
    async () => {
      const school = await registerSchool(`Gating Cap School ${uid()}`);
      await setPlan(school.schoolId, "BASIC");
      const cls = await prisma.class.create({ data: { schoolId: school.schoolId, name: `Class ${uid()}` } });
      const section = await prisma.section.create({ data: { schoolId: school.schoolId, classId: cls.id, name: "A" } });
      const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
      // Bulk-create 500 pupils directly (two statements — bcrypt per row
      // would take minutes and proves nothing about the cap itself).
      const tag = uid();
      const userRows = Array.from({ length: 500 }, (_, i) => ({
        id: randomUUID(),
        schoolId: school.schoolId,
        roleId: studentRole.id,
        email: `cap-${tag}-${i}@example.com`,
        passwordHash: "x",
        name: `Cap Pupil ${i}`,
      }));
      await prisma.user.createMany({ data: userRows });
      await prisma.student.createMany({
        data: userRows.map((u) => ({ schoolId: school.schoolId, userId: u.id, sectionId: section.id })),
      });
      expect(await prisma.student.count({ where: { schoolId: school.schoolId } })).toBe(500);

      const blocked = await request(app)
        .post(`/api/v1/schools/${school.schoolId}/students`)
        .set("Authorization", `Bearer ${school.adminToken}`)
        .send({ name: "Pupil 501", email: `cap-501-${tag}@example.com`, sectionId: section.id, admissionNo: `ADM-${tag}` });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("PLAN_UPGRADE_REQUIRED");

      // Upgrade to Standard (cap 1500): the same admission goes through.
      await setPlan(school.schoolId, "STANDARD");
      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/students`)
        .set("Authorization", `Bearer ${school.adminToken}`)
        .send({ name: "Pupil 501", email: `cap-501-${tag}@example.com`, sectionId: section.id, admissionNo: `ADM-${tag}` })
        .expect(201);

      // Downgrade back below the headcount: reads unaffected, nothing
      // deleted — only NEW admissions block.
      await setPlan(school.schoolId, "BASIC");
      const roster = await request(app)
        .get(`/api/v1/schools/${school.schoolId}/students`)
        .set("Authorization", `Bearer ${school.adminToken}`)
        .expect(200);
      expect(roster.body.data.students.length).toBeGreaterThan(0);
      expect(await prisma.student.count({ where: { schoolId: school.schoolId } })).toBe(501);
    },
  );
});
