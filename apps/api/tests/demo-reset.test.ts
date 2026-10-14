import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { runDemoResetJob } from "../src/modules/jobs/jobs.service.js";

const app = createApp();

const TEST_CRON_SECRET = "test-cron-secret-0123456789abcdef";
const savedSecret = process.env.CRON_SECRET;

function uid(): string {
  return randomUUID().slice(0, 8);
}

beforeAll(() => {
  process.env.CRON_SECRET = TEST_CRON_SECRET;
});

afterAll(() => {
  if (savedSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = savedSecret;
  }
});

// Minimal demo-school fixture: the school row plus one row in three child
// tables (user → notice/ticket), enough to prove the wipe reaches leaves
// and roots alike.
async function makeSchool(
  slug: string,
  isDemo: boolean,
): Promise<{ schoolId: string; adminId: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "SCHOOL_ADMIN" } });
  const school = await prisma.school.create({
    data: {
      slug,
      name: `Reset School ${uid()}`,
      trialEndsAt: new Date("2027-10-27T00:00:00Z"),
      isDemo,
    },
  });
  const admin = await prisma.user.create({
    data: {
      schoolId: school.id,
      roleId: role.id,
      email: `reset-admin-${uid()}@example.com`,
      passwordHash: await bcrypt.hash("x", 4),
      name: "Reset Admin",
    },
  });
  await prisma.notice.create({
    data: { schoolId: school.id, title: `Reset notice ${uid()}`, body: "x", target: "SCHOOL", createdById: admin.id },
  });
  await prisma.ticket.create({
    data: { schoolId: school.id, createdById: admin.id, subject: `Reset ticket ${uid()}`, priority: "LOW" },
  });
  return { schoolId: school.id, adminId: admin.id };
}

async function childCounts(schoolId: string): Promise<{ users: number; notices: number; tickets: number }> {
  const [users, notices, tickets] = await Promise.all([
    prisma.user.count({ where: { schoolId } }),
    prisma.notice.count({ where: { schoolId } }),
    prisma.ticket.count({ where: { schoolId } }),
  ]);
  return { users, notices, tickets };
}

describe("nightly demo reset (§13.11)", () => {
  it("wipes allowlisted demo schools and reseeds", async () => {
    const sos = await makeSchool("school-of-science", true);
    const rk = await makeSchool("ramakrishna-school", true);
    let reseeds = 0;

    const result = await runDemoResetJob(prisma, {
      reseed: async () => {
        reseeds += 1;
      },
    });

    expect(result.reset.sort()).toEqual(["ramakrishna-school", "school-of-science"]);
    expect(result.refused).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(reseeds).toBe(1);
    // Wiped to the root: schools gone, children gone with them.
    expect(await prisma.school.count({ where: { id: { in: [sos.schoolId, rk.schoolId] } } })).toBe(0);
    expect(await childCounts(sos.schoolId)).toEqual({ users: 0, notices: 0, tickets: 0 });
    expect(await childCounts(rk.schoolId)).toEqual({ users: 0, notices: 0, tickets: 0 });
  });

  it("ignores non-allowlisted schools entirely", async () => {
    const other = await makeSchool(`ordinary-school-${uid()}`, false);
    let reseeds = 0;

    const result = await runDemoResetJob(prisma, {
      reseed: async () => {
        reseeds += 1;
      },
    });

    // No allowlisted schools exist here: both reported missing (the reseed
    // recreates them in production), the ordinary school untouched.
    expect(result.missing.sort()).toEqual(["ramakrishna-school", "school-of-science"]);
    expect(result.refused).toEqual([]);
    expect(reseeds).toBe(1);
    expect(await prisma.school.count({ where: { id: other.schoolId } })).toBe(1);
    expect(await childCounts(other.schoolId)).toEqual({ users: 1, notices: 1, tickets: 1 });
  });

  it("refuses a non-demo squatter and deletes NOTHING (fail-closed whole run)", async () => {
    const squatter = await makeSchool("school-of-science", false);
    const demo = await makeSchool("ramakrishna-school", true);
    let reseeds = 0;

    const result = await runDemoResetJob(prisma, {
      reseed: async () => {
        reseeds += 1;
      },
    });

    expect(result.refused).toEqual([{ slug: "school-of-science", reason: "not a demo school — wipe refused" }]);
    expect(result.reset).toEqual([]);
    expect(reseeds).toBe(0);
    // The squatter survives AND the healthy demo school survives — one
    // anomaly aborts the whole night, a human looks, the job guesses never.
    expect(await prisma.school.count({ where: { id: squatter.schoolId } })).toBe(1);
    expect(await childCounts(squatter.schoolId)).toEqual({ users: 1, notices: 1, tickets: 1 });
    expect(await prisma.school.count({ where: { id: demo.schoolId } })).toBe(1);
    expect(await childCounts(demo.schoolId)).toEqual({ users: 1, notices: 1, tickets: 1 });

    // The HTTP route reports the same refusal (secret auth, no reseed ran).
    const res = await request(app)
      .post("/api/v1/internal/jobs/demo-reset")
      .set({ "X-Cron-Secret": TEST_CRON_SECRET })
      .expect(200);
    expect(res.body.data.job).toBe("demo-reset");
    expect(res.body.data.refused).toEqual([{ slug: "school-of-science", reason: "not a demo school — wipe refused" }]);

    // Cleanup: the squatter must not poison later suites (slug is global).
    // Children first (RESTRICT everywhere), then users, then the school.
    const users = await prisma.user.findMany({ where: { schoolId: squatter.schoolId }, select: { id: true } });
    const ids = users.map((u) => u.id);
    await prisma.$transaction([
      prisma.ticket.deleteMany({ where: { schoolId: squatter.schoolId } }),
      prisma.notice.deleteMany({ where: { schoolId: squatter.schoolId } }),
      prisma.auditLog.deleteMany({ where: { schoolId: squatter.schoolId } }),
      prisma.authToken.deleteMany({ where: { userId: { in: ids } } }),
      prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } }),
      prisma.user.deleteMany({ where: { schoolId: squatter.schoolId } }),
      prisma.school.delete({ where: { id: squatter.schoolId } }),
    ]);
    const demoUsers = await prisma.user.findMany({ where: { schoolId: demo.schoolId }, select: { id: true } });
    const demoIds = demoUsers.map((u) => u.id);
    await prisma.$transaction([
      prisma.ticket.deleteMany({ where: { schoolId: demo.schoolId } }),
      prisma.notice.deleteMany({ where: { schoolId: demo.schoolId } }),
      prisma.auditLog.deleteMany({ where: { schoolId: demo.schoolId } }),
      prisma.authToken.deleteMany({ where: { userId: { in: demoIds } } }),
      prisma.refreshToken.deleteMany({ where: { userId: { in: demoIds } } }),
      prisma.user.deleteMany({ where: { schoolId: demo.schoolId } }),
      prisma.school.delete({ where: { id: demo.schoolId } }),
    ]);
  });
});
