import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { recordAudit } from "../src/lib/audit.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(name: string): Promise<{ schoolId: string; adminToken: string; adminId: string }> {
  const adminEmail = `reads-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Reads Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: adminEmail } } });
  return { schoolId, adminToken: res.body.data.accessToken as string, adminId: admin.id };
}

async function writeRow(schoolId: string | null, actorId: string, action: string): Promise<string> {
  const row = await recordAudit(prisma, {
    schoolId,
    actorId,
    action,
    entity: "School",
    entityId: schoolId,
    after: { id: schoolId ?? "platform", subscriptionStatus: "ACTIVE", plan: "PREMIUM", isDemo: true },
  });
  return row.id;
}

function listOwn(schoolId: string, token: string, query: string) {
  // NOT async: must return the supertest chain itself so callers can
  // .expect() on it (awaiting first would hand back a bare response).
  return request(app)
    .get(`/api/v1/schools/${schoolId}/audit-logs${query}`)
    .set("Authorization", `Bearer ${token}`);
}

describe("audit tenant isolation with data on both sides (§13.10)", () => {
  it("a School of Science admin never sees a Ramakrishna row, and vice versa", async () => {
    const sos = await registerSchool(`School of Science ${uid()}`);
    const rk = await registerSchool(`Ramakrishna School ${uid()}`);
    await writeRow(sos.schoolId, sos.adminId, "SOS_WRITE");
    await writeRow(rk.schoolId, rk.adminId, "RK_WRITE");

    const sosRes = await listOwn(sos.schoolId, sos.adminToken, "?take=100").expect(200);
    const sosRows = sosRes.body.data.logs as { id: string; schoolId: string; action: string }[];
    expect(sosRows.length).toBeGreaterThan(0);
    for (const row of sosRows) {
      expect(row.schoolId).toBe(sos.schoolId);
    }
    expect(sosRows.some((r) => r.action === "SOS_WRITE")).toBe(true);
    expect(sosRows.some((r) => r.action === "RK_WRITE")).toBe(false);

    const rkRes = await listOwn(rk.schoolId, rk.adminToken, "?take=100").expect(200);
    const rkRows = rkRes.body.data.logs as { id: string; schoolId: string; action: string }[];
    for (const row of rkRows) {
      expect(row.schoolId).toBe(rk.schoolId);
    }
    expect(rkRows.some((r) => r.action === "RK_WRITE")).toBe(true);
    expect(rkRows.some((r) => r.action === "SOS_WRITE")).toBe(false);
  });

  it("a platform-level (NULL school) row is invisible to every school", async () => {
    const schoolA = await registerSchool(`Null Blind A ${uid()}`);
    const schoolB = await registerSchool(`Null Blind B ${uid()}`);
    await writeRow(null, schoolA.adminId, "PLATFORM_WRITE");
    await writeRow(schoolA.schoolId, schoolA.adminId, "A_WRITE");

    for (const school of [schoolA, schoolB]) {
      const res = await listOwn(school.schoolId, school.adminToken, "?take=100").expect(200);
      const rows = res.body.data.logs as { schoolId: string | null; action: string }[];
      expect(rows.some((r) => r.action === "PLATFORM_WRITE")).toBe(false);
      for (const row of rows) {
        expect(row.schoolId).not.toBeNull();
      }
    }
  });
});

describe("audit cursor pagination (§13.10)", () => {
  it("walks newest-first with no overlap and no gaps, ending on a null cursor", async () => {
    const school = await registerSchool(`Cursor School ${uid()}`);
    await writeRow(school.schoolId, school.adminId, "CURSOR_ONE");
    await writeRow(school.schoolId, school.adminId, "CURSOR_TWO");
    await writeRow(school.schoolId, school.adminId, "CURSOR_THREE");

    // The walk is scoped to this admin's rows so parallel files' data can
    // never leak into counts — order-dependent assertions are banned here.
    const walk1 = await listOwn(school.schoolId, school.adminToken, `?take=2&actorId=${school.adminId}`).expect(200);
    const ids1 = (walk1.body.data.logs as { id: string }[]).map((r) => r.id);
    const cursor1 = walk1.body.data.nextCursor as string | null;
    expect(ids1).toHaveLength(2);
    expect(typeof cursor1).toBe("string");

    const walk2 = await listOwn(school.schoolId, school.adminToken, `?take=2&actorId=${school.adminId}&cursor=${encodeURIComponent(cursor1 ?? "")}`).expect(200);
    const ids2 = (walk2.body.data.logs as { id: string }[]).map((r) => r.id);
    expect(ids2.length).toBeGreaterThanOrEqual(1);
    expect(ids2.some((id) => ids1.includes(id))).toBe(false);
    // Full walk covers all three cursor rows exactly once.
    const seen = new Set([...ids1, ...ids2]);
    const cursorRows = await prisma.auditLog.findMany({
      where: { schoolId: school.schoolId, action: { startsWith: "CURSOR_" } },
      select: { id: true },
    });
    for (const row of cursorRows) {
      expect(seen.has(row.id)).toBe(true);
    }
    if ((walk2.body.data.logs as unknown[]).length === 2) {
      expect(typeof walk2.body.data.nextCursor).toBe("string");
    } else {
      expect(walk2.body.data.nextCursor).toBeNull();
    }
  });

  it("rejects a tampered cursor with 400, never a silent full scan", async () => {
    const school = await registerSchool(`Cursor Tamper School ${uid()}`);
    const res = await listOwn(school.schoolId, school.adminToken, "?take=10&cursor=not-a-cursor");
    expect(res.status).toBe(400);
  });
});

describe("audit filters: actor, action, date (§13.10)", () => {
  it("narrows by actorId and action independently", async () => {
    const school = await registerSchool(`Filter School ${uid()}`);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "ACCOUNTANT" } });
    const second = await prisma.user.create({
      data: { schoolId: school.schoolId, roleId: role.id, email: `filter-second-${uid()}@example.com`, passwordHash: "x", name: "Second" },
    });
    await writeRow(school.schoolId, school.adminId, "FILTER_MINE");
    await writeRow(school.schoolId, second.id, "FILTER_THEIRS");

    const mine = await listOwn(school.schoolId, school.adminToken, `?take=100&actorId=${school.adminId}`).expect(200);
    const mineRows = mine.body.data.logs as { actorId: string }[];
    expect(mineRows.length).toBeGreaterThan(0);
    for (const row of mineRows) {
      expect(row.actorId).toBe(school.adminId);
    }

    const action = await listOwn(school.schoolId, school.adminToken, "?take=100&action=FILTER_THEIRS").expect(200);
    const actionRows = action.body.data.logs as { action: string; actorId: string }[];
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0]?.actorId).toBe(second.id);
  });

  it("bounds by UTC calendar day: today matches, tomorrow and yesterday do not", async () => {
    const school = await registerSchool(`Date School ${uid()}`);
    await writeRow(school.schoolId, school.adminId, "DATE_WRITE");
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const hit = await listOwn(school.schoolId, school.adminToken, `?take=100&action=DATE_WRITE&from=${today}&to=${today}`).expect(200);
    expect((hit.body.data.logs as unknown[])).toHaveLength(1);

    const future = await listOwn(school.schoolId, school.adminToken, `?take=100&action=DATE_WRITE&from=${tomorrow}`).expect(200);
    expect((future.body.data.logs as unknown[])).toHaveLength(0);

    const past = await listOwn(school.schoolId, school.adminToken, `?take=100&action=DATE_WRITE&to=${yesterday}`).expect(200);
    expect((past.body.data.logs as unknown[])).toHaveLength(0);
  });

  it("rejects a malformed date with 400", async () => {
    const school = await registerSchool(`Date Format School ${uid()}`);
    const res = await listOwn(school.schoolId, school.adminToken, "?take=10&from=10-10-2026");
    expect(res.status).toBe(400);
  });
});

describe("platform audit reads (§13.10)", () => {
  it("paginates across schools for the Owner with the shared cursor", async () => {
    const schoolA = await registerSchool(`Platform Page A ${uid()}`);
    const schoolB = await registerSchool(`Platform Page B ${uid()}`);
    const email = `platform-reader-${uid()}@example.com`;
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
    await prisma.user.create({
      data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Platform Reader" },
    });
    // Owner login writes its own audit row — use the real login path.
    const login = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
    const token = login.body.data.accessToken as string;
    await writeRow(schoolA.schoolId, schoolA.adminId, "PLATFORM_PAGE_A");
    await writeRow(schoolB.schoolId, schoolB.adminId, "PLATFORM_PAGE_B");

    const page1 = await request(app)
      .get("/api/v1/platform/audit-logs?take=2")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((page1.body.data.logs as unknown[])).toHaveLength(2);
    const cursor = page1.body.data.nextCursor as string | null;
    expect(typeof cursor).toBe("string");

    const page2 = await request(app)
      .get(`/api/v1/platform/audit-logs?take=2&cursor=${encodeURIComponent(cursor ?? "")}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const ids1 = (page1.body.data.logs as { id: string }[]).map((r) => r.id);
    const ids2 = (page2.body.data.logs as { id: string }[]).map((r) => r.id);
    expect(ids2.some((id) => ids1.includes(id))).toBe(false);
  });
});
