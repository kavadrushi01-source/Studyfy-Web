import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decideDemoPassword,
  DEV_FALLBACK_PASSWORD,
  isLocalDatabaseUrl,
  resetDemoPasswords,
  OWNER_EMAIL,
} from "../../../prisma/seed.js";
import { prisma } from "../src/lib/prisma.js";

function uid(): string {
  return randomUUID().slice(0, 8);
}

const LOCAL = "mysql://root@127.0.0.1:3307/studyfy_dev";
const REMOTE = "mysql://user:secret@prod-host.aivencloud.com:24500/studyfy";

describe("demo password gate (§13.11)", () => {
  it("lets the environment win everywhere, including production", () => {
    expect(decideDemoPassword({ NODE_ENV: "production", DEMO_PASSWORD: "rotated-strong-pw" }, REMOTE)).toEqual({
      password: "rotated-strong-pw",
      source: "environment",
    });
  });

  it("allows the documented fallback only for a local DB with NODE_ENV=development", () => {
    expect(decideDemoPassword({ NODE_ENV: "development" }, LOCAL)).toEqual({
      password: DEV_FALLBACK_PASSWORD,
      source: "local fallback",
    });
    expect(DEV_FALLBACK_PASSWORD).toBe("Demo@1234");
  });

  it("refuses local seeding without the variable unless NODE_ENV=development", () => {
    expect(() => decideDemoPassword({}, LOCAL)).toThrow(/Refusing to seed/);
    expect(() => decideDemoPassword({ NODE_ENV: "test" }, LOCAL)).toThrow(/Refusing to seed/);
    expect(() => decideDemoPassword({ NODE_ENV: "production" }, LOCAL)).toThrow(/Refusing to seed/);
  });

  it("refuses a REMOTE database without the variable even in development", () => {
    expect(() => decideDemoPassword({ NODE_ENV: "development" }, REMOTE)).toThrow(/Refusing to seed/);
    expect(() => decideDemoPassword({ NODE_ENV: "production" }, REMOTE)).toThrow(/Refusing to seed/);
  });

  it("treats an unparseable DATABASE_URL as remote (fail closed)", () => {
    expect(isLocalDatabaseUrl("not-a-url")).toBe(false);
    expect(isLocalDatabaseUrl("")).toBe(false);
    expect(() => decideDemoPassword({ NODE_ENV: "development" }, "not-a-url")).toThrow(/Refusing to seed/);
  });

  it("uses read-only login for production demo schools only", async () => {
    const { shouldUseReadOnlyDemoLogin } = await import("../src/modules/auth/auth.service.js");
    expect(shouldUseReadOnlyDemoLogin(true, "production")).toBe(true);
    expect(shouldUseReadOnlyDemoLogin(false, "production")).toBe(false);
    expect(shouldUseReadOnlyDemoLogin(true, "test")).toBe(false);
  });
});

describe("reset demo passwords mode (§13.11 rotation)", () => {
  it("rewrites ONLY demo passwordHashes — data and real schools untouched, re-runnable", async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: "SCHOOL_ADMIN" } });
    const tag = uid();
    const demoSchool = await prisma.school.create({
      data: {
        name: `Reset Demo School ${tag}`,
        slug: `reset-demo-${tag}`,
        subscriptionStatus: "ACTIVE",
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isDemo: true,
      },
    });
    const realSchool = await prisma.school.create({
      data: {
        name: `Reset Real School ${tag}`,
        slug: `reset-real-${tag}`,
        subscriptionStatus: "ACTIVE",
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const oldHash = await bcrypt.hash("old-documented-pw", 4);
    const demoUser = await prisma.user.create({
      data: {
        schoolId: demoSchool.id,
        roleId: adminRole.id,
        email: `reset-demo-${tag}@example.com`,
        passwordHash: oldHash,
        name: "Reset Demo Admin",
      },
    });
    const ownerRole = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
    const owner = await prisma.user.create({
      data: {
        schoolId: null,
        roleId: ownerRole.id,
        email: OWNER_EMAIL,
        passwordHash: oldHash,
        name: "Seed Owner Password Test",
      },
    });
    const realUser = await prisma.user.create({
      data: {
        schoolId: realSchool.id,
        roleId: adminRole.id,
        email: `reset-real-${tag}@example.com`,
        passwordHash: oldHash,
        name: "Reset Real Admin",
      },
    });

    const first = await resetDemoPasswords(prisma, "Demo@1234", "owner-private-password-123");
    expect(first.schools.some((s) => s.slug === demoSchool.slug && s.updated === 1)).toBe(true);
    // Idempotent: same call again converges (fresh salt, same password).
    const second = await resetDemoPasswords(prisma, "Demo@1234", "owner-private-password-123");
    expect(second.schools.some((s) => s.slug === demoSchool.slug && s.updated === 1)).toBe(true);

    const demoAfter = await prisma.user.findUniqueOrThrow({ where: { id: demoUser.id } });
    expect(await bcrypt.compare("Demo@1234", demoAfter.passwordHash)).toBe(true);
    expect(await bcrypt.compare("old-documented-pw", demoAfter.passwordHash)).toBe(false);
    // Only the hash changed — every other column identical.
    expect({ ...demoAfter, passwordHash: "x", updatedAt: demoAfter.updatedAt }).toMatchObject({
      email: demoUser.email,
      name: "Reset Demo Admin",
      schoolId: demoSchool.id,
    });

    const ownerAfter = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(await bcrypt.compare("owner-private-password-123", ownerAfter.passwordHash)).toBe(true);
    expect(await bcrypt.compare("Demo@1234", ownerAfter.passwordHash)).toBe(false);

    // The real school's account is byte-identical (same hash → untouched).
    const realAfter = await prisma.user.findUniqueOrThrow({ where: { id: realUser.id } });
    expect(realAfter.passwordHash).toBe(oldHash);
  });
});
