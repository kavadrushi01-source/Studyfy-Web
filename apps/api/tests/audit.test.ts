import bcrypt from "bcryptjs";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pickAuditFields, recordAudit } from "../src/lib/audit.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(name: string): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: name,
      adminName: "Audit Test Admin",
      adminEmail: `audit-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  // Device + remarks rows are Phase 3-gated (§16.1): this fixture school
  // buys Premium+Active. Plan-gating itself is proven in
  // billing-gating.test.ts.
  const schoolId = res.body.data.school.id as string;
  await prisma.school.update({ where: { id: schoolId }, data: { plan: "PREMIUM", subscriptionStatus: "ACTIVE" } });
  return {
    schoolId,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function loginAs(slug: string, email: string, password: string): Promise<string> {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password, schoolSlug: slug })
    .expect(200);
  return res.body.data.accessToken as string;
}

async function createUser(
  schoolId: string,
  slug: string,
  roleName: "TEACHER" | "PARENT",
): Promise<{ email: string; token: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const email = `audit-${roleName.toLowerCase()}-${uid()}@example.com`;
  await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash("user-pass-123", 4), name: `Audit ${roleName}` },
  });
  const token = await loginAs(slug, email, "user-pass-123");
  return { email, token };
}

async function loginOwner(): Promise<{ token: string; ownerId: string }> {
  const email = `owner-${uid()}@example.com`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
  const owner = await prisma.user.create({
    data: {
      schoolId: null,
      roleId: role.id,
      email,
      passwordHash: await bcrypt.hash("owner-pass-123", 4),
      name: "Platform Owner",
    },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
  return { token: res.body.data.accessToken as string, ownerId: owner.id };
}

describe("audit allowlists (§13.10 redaction)", () => {
  it("throws on an entity with no allowlist instead of logging the whole row", () => {
    // NOTE: this must name an entity with genuinely no allowlist — every
    // entity in AUDIT_FIELDS is a wrong answer here (FeePayment joined the
    // list in the §13.10 retrofit and broke this test once; lesson kept).
    expect(() => pickAuditFields("FeeRefund", { id: "x", razorpayPaymentId: "pay_secret" })).toThrow(
      /No audit allowlist/,
    );
  });

  it("keeps only allowlisted fields — hashes, keys and secrets never land in a log", () => {
    const picked = pickAuditFields("User", {
      id: "u1",
      role: "SCHOOL_ADMIN",
      isActive: true,
      passwordHash: "LEAK-ME-NOT",
      email: "admin@school.example",
    });
    expect(picked).toEqual({ id: "u1", role: "SCHOOL_ADMIN", isActive: true });
    expect(JSON.stringify(picked)).not.toContain("LEAK-ME-NOT");

    const device = pickAuditFields("BiometricDevice", {
      id: "d1",
      name: "Gate terminal",
      isActive: false,
      apiKeyHash: "LEAK-ME-NOT",
    });
    expect(device).toEqual({ id: "d1", name: "Gate terminal", isActive: false });
    expect(JSON.stringify(device)).not.toContain("LEAK-ME-NOT");
  });

  it("recordAudit persists a row the school admin can then read", async () => {
    const school = await registerSchool(`Audit Write School ${uid()}`);
    const admin = await prisma.user.findFirstOrThrow({ where: { schoolId: school.schoolId } });
    await recordAudit(prisma, {
      schoolId: school.schoolId,
      actorId: admin.id,
      action: "TEST_WRITE",
      entity: "School",
      entityId: school.schoolId,
      after: { id: school.schoolId, subscriptionStatus: "TRIAL", plan: null, isDemo: false },
    });
    const res = await request(app)
      .get(`/api/v1/schools/${school.schoolId}/audit-logs?action=TEST_WRITE`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .expect(200);
    expect(res.body.data.logs).toHaveLength(1);
    expect(res.body.data.logs[0]).toMatchObject({ action: "TEST_WRITE", entity: "School" });
  });
});

describe("audit event wiring (§13.10 must-list)", () => {
  it("audits device register with an allowlisted snapshot (no key hash)", async () => {
    const school = await registerSchool(`Audit Device School ${uid()}`);
    const reg = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/biometric/devices`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ name: "Front gate" })
      .expect(201);
    const deviceId = reg.body.data.device.id as string;

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { schoolId: school.schoolId, action: "DEVICE_REGISTER", entityId: deviceId },
    });
    expect(row.after).toMatchObject({ id: deviceId, name: "Front gate", isActive: true });
    expect(JSON.stringify(row.after)).not.toContain("apiKeyHash");
    expect(row.before).toBeNull();
  });

  it("audits device suspend AND resume with before/after", async () => {
    const school = await registerSchool(`Audit Suspend School ${uid()}`);
    const reg = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/biometric/devices`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ name: "Back gate" })
      .expect(201);
    const deviceId = reg.body.data.device.id as string;

    await request(app)
      .patch(`/api/v1/schools/${school.schoolId}/biometric/devices/${deviceId}`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ isActive: false })
      .expect(200);

    const suspend = await prisma.auditLog.findFirstOrThrow({
      where: { schoolId: school.schoolId, action: "DEVICE_SUSPEND", entityId: deviceId },
    });
    expect(suspend.before).toMatchObject({ isActive: true });
    expect(suspend.after).toMatchObject({ isActive: false });

    await request(app)
      .patch(`/api/v1/schools/${school.schoolId}/biometric/devices/${deviceId}`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ isActive: true })
      .expect(200);
    const resume = await prisma.auditLog.findFirstOrThrow({
      where: { schoolId: school.schoolId, action: "DEVICE_RESUME", entityId: deviceId },
    });
    expect(resume.before).toMatchObject({ isActive: false });
    expect(resume.after).toMatchObject({ isActive: true });
  });

  it("audits every Platform Owner login as a platform-level (NULL school) row", async () => {
    const { ownerId } = await loginOwner();
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: "OWNER_LOGIN", entityId: ownerId },
    });
    expect(row.schoolId).toBeNull();
    expect(row.actorId).toBe(ownerId);
    expect(row.after).toMatchObject({ id: ownerId, role: "PLATFORM_OWNER" });
    expect(JSON.stringify(row.after)).not.toContain("passwordHash");
  });
});

describe("audit read visibility (§13.10)", () => {
  it("lets a School Admin read their own school's logs but NOT platform-level rows", async () => {
    const school = await registerSchool(`Audit Read School ${uid()}`);
    await loginOwner(); // writes a NULL-school OWNER_LOGIN row
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/biometric/devices`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ name: "Side gate" })
      .expect(201);

    const res = await request(app)
      .get(`/api/v1/schools/${school.schoolId}/audit-logs`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .expect(200);
    const logs = res.body.data.logs as { action: string; schoolId: string | null }[];
    expect(logs.length).toBeGreaterThan(0);
    // Every visible row belongs to this school — the NULL platform rows
    // (owner logins) stay invisible. That hiding IS the fail-closed proof.
    for (const log of logs) {
      expect(log.schoolId).toBe(school.schoolId);
    }
    expect(logs.some((l) => l.action === "DEVICE_REGISTER")).toBe(true);
  });

  it("rejects a School Admin reading ANOTHER school's logs (both directions)", async () => {
    const schoolA = await registerSchool(`Audit Cross A ${uid()}`);
    const schoolB = await registerSchool(`Audit Cross B ${uid()}`);

    const aReadsB = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/audit-logs`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`);
    expect(aReadsB.status).toBe(403);
    expect(aReadsB.body.error.code).toBe("TENANT_MISMATCH");

    const bReadsA = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/audit-logs`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`);
    expect(bReadsA.status).toBe(403);
    expect(bReadsA.body.error.code).toBe("TENANT_MISMATCH");
  });

  it("refuses teachers and parents (nobody else reads logs)", async () => {
    const school = await registerSchool(`Audit Gates School ${uid()}`);
    const teacher = await createUser(school.schoolId, school.slug, "TEACHER");
    const parent = await createUser(school.schoolId, school.slug, "PARENT");

    const teacherRes = await request(app)
      .get(`/api/v1/schools/${school.schoolId}/audit-logs`)
      .set("Authorization", `Bearer ${teacher.token}`);
    expect(teacherRes.status).toBe(403);

    const parentRes = await request(app)
      .get(`/api/v1/schools/${school.schoolId}/audit-logs`)
      .set("Authorization", `Bearer ${parent.token}`);
    expect(parentRes.status).toBe(403);
  });

  it("lets the Platform Owner read everything, including NULL rows, with an optional school filter", async () => {
    const school = await registerSchool(`Audit Owner School ${uid()}`);
    const { token } = await loginOwner();
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/biometric/devices`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ name: "Owner-view gate" })
      .expect(201);

    const all = await request(app)
      .get("/api/v1/platform/audit-logs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const rows = all.body.data.logs as { action: string; schoolId: string | null }[];
    // The Owner sees platform-level rows no school can.
    expect(rows.some((r) => r.schoolId === null && r.action === "OWNER_LOGIN")).toBe(true);
    expect(rows.some((r) => r.schoolId === school.schoolId && r.action === "DEVICE_REGISTER")).toBe(true);

    const filtered = await request(app)
      .get(`/api/v1/platform/audit-logs?schoolId=${school.schoolId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const narrowed = filtered.body.data.logs as { schoolId: string | null }[];
    expect(narrowed.length).toBeGreaterThan(0);
    for (const row of narrowed) {
      expect(row.schoolId).toBe(school.schoolId);
    }
  });

  it("refuses a School Admin on the platform route and strangers on both", async () => {
    const school = await registerSchool(`Audit Refusal School ${uid()}`);

    const adminOnPlatform = await request(app)
      .get("/api/v1/platform/audit-logs")
      .set("Authorization", `Bearer ${school.adminToken}`);
    expect(adminOnPlatform.status).toBe(403);

    const anonSchool = await request(app).get(`/api/v1/schools/${school.schoolId}/audit-logs`);
    expect(anonSchool.status).toBe(401);

    const anonPlatform = await request(app).get("/api/v1/platform/audit-logs");
    expect(anonPlatform.status).toBe(401);
  });
});

describe("audit append-only (§13.10)", () => {
  it("has no code path that updates or deletes an audit row", () => {
    // The load-bearing guarantee is structural: recordAudit() is the only
    // writer and it only creates. This test walks src/ so a future
    // auditLog.update/delete slips in loudly instead of silently.
    //
    // SINGLE EXEMPTION (founder-visible, do not widen silently): the
    // nightly demo reset (wipeSchoolScope in jobs.service.ts) destroys and
    // recreates the two demo schools (§13.11) — their audit rows cannot
    // outlive them, because the actor FKs would otherwise make the users
    // (and therefore the school) undeletable, and orphaned rows would
    // pollute the platform trail with dead history. This is the opposite
    // of tampering (announced, bannered, reported, double-guarded), but it
    // IS a delete, so it lives here in the open — not smuggled past this
    // test. Any other file, or any other method in that file, still fails.
    const EXEMPT = new Map<string, string[]>([["jobs.service.ts", ["auditLog.deleteMany"]]]);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith(".ts")) {
          continue;
        }
        const text = readFileSync(full, "utf8");
        const matches = text.match(/auditLog\.(update|updateMany|delete|deleteMany|upsert|createMany)\b/g);
        if (matches) {
          const file = full.split(/[\\/]/).pop() ?? full;
          const allowed = EXEMPT.get(file) ?? [];
          const remaining = matches.filter((m) => !allowed.includes(m));
          if (remaining.length > 0) {
            offenders.push(`${full}: ${remaining.join(", ")}`);
          }
        }
      }
    };
    // ESM has no __dirname — resolve from the test file's own URL.
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
