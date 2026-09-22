import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { seedPermissions, seedRoles } from "../../../prisma/seed.js";

// CI runs test files in parallel workers sharing ONE MySQL database, and
// every worker's setup calls seedRoles + seedPermissions. These must be
// safe under concurrency — Prisma upsert() is SELECT-then-INSERT (not
// atomic), so N parallel upsert loops race on the unique key and die with
// P2002 (CI runs 35725384214, 35611906623: roles_name_key,
// permissions_key_key). This file is those N parallel callers.
describe("concurrent global seeding (CI parallel workers)", () => {
  it("seedRoles survives parallel callers with no duplicates and fresh descriptions", async () => {
    const before = await prisma.role.count();
    await Promise.all(Array.from({ length: 20 }, () => seedRoles(prisma)));
    expect(await prisma.role.count()).toBe(before);
    const admin = await prisma.role.findUnique({ where: { name: "SCHOOL_ADMIN" } });
    expect(admin?.description).toContain("configuration");
  });

  it("seedRoles survives parallel callers even when a row is missing (the CI interleave)", async () => {
    // Worst case, deterministic: LIBRARIAN is never held by any test user
    // and no mapping references it, so deleting it is invisible to every
    // other file running in parallel — while every caller here SELECT-misses
    // and INSERTs the same row. Old upsert-loop code dies here with P2002.
    const before = await prisma.role.count();
    await prisma.role.deleteMany({ where: { name: "LIBRARIAN" } });
    await Promise.all(Array.from({ length: 20 }, () => seedRoles(prisma)));
    expect(await prisma.role.count()).toBe(before);
    expect(await prisma.role.findUnique({ where: { name: "LIBRARIAN" } })).not.toBeNull();
  });

  it("seedPermissions survives parallel callers with mappings intact", async () => {
    const beforePerms = await prisma.permission.count();
    const beforeMappings = await prisma.rolePermission.count();
    await Promise.all(
      Array.from({ length: 10 }, () => Promise.all([seedRoles(prisma), seedPermissions(prisma)])),
    );
    expect(await prisma.permission.count()).toBe(beforePerms);
    expect(await prisma.rolePermission.count()).toBe(beforeMappings);
    const admin = await prisma.role.findUnique({ where: { name: "SCHOOL_ADMIN" } });
    const canMessage = await prisma.rolePermission.findFirst({
      where: { roleId: admin?.id ?? "", permission: { key: "messages.read" } },
    });
    expect(canMessage).not.toBeNull();
  });
});
