import { describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { seedPermissions, seedRoles } from "../../../prisma/seed.js";

// CI runs test files in parallel workers sharing ONE MySQL database, and
// every worker's setup calls seedRoles + seedPermissions. These must be
// safe under concurrency — Prisma upsert() is SELECT-then-INSERT (not
// atomic), so N parallel upsert loops race on the unique key and die with
// P2002 (CI runs 35725384214, 35611906623: roles_name_key,
// permissions_key_key). This file is those N parallel callers.
//
// Every assertion is scoped to the CANONICAL seeded rows, never a global
// table count: sibling test files create/delete throwaway rows in the same
// tables mid-run (rbac.test.ts -> TEMP_RBAC_* roles + their mappings), and
// a before/after global count is not a stable invariant across parallel
// workers — isolated runs pass, full-suite runs flake when that window
// interleaves (seen locally 4/4 times before this fix).
const CANONICAL_ROLES = [
  "PLATFORM_OWNER",
  "SCHOOL_ADMIN",
  "TEACHER",
  "ACCOUNTANT",
  "STUDENT",
  "PARENT",
  "LIBRARIAN",
  "TRANSPORT_MANAGER",
];

describe("concurrent global seeding (CI parallel workers)", () => {
  it("seedRoles survives parallel callers with no duplicates and fresh descriptions", async () => {
    await Promise.all(Array.from({ length: 20 }, () => seedRoles(prisma)));
    for (const name of CANONICAL_ROLES) {
      expect(await prisma.role.count({ where: { name } })).toBe(1);
    }
    const admin = await prisma.role.findUnique({ where: { name: "SCHOOL_ADMIN" } });
    expect(admin?.description).toContain("configuration");
  });

  it("seedRoles survives parallel callers even when a row is missing (the CI interleave)", async () => {
    // Worst case, deterministic: TRANSPORT_MANAGER is never held by any
    // test user, so deleting it (mappings first, then the row) is
    // invisible to every other file running in parallel — while every
    // caller here SELECT-misses and INSERTs the same row. Old upsert-loop
    // code dies here with P2002. (LIBRARIAN served this role until Chunk
    // 3 mapped it; every role row is mapped now, so mappings go first.)
    const doomed = await prisma.role.findUniqueOrThrow({ where: { name: "TRANSPORT_MANAGER" } });
    await prisma.rolePermission.deleteMany({ where: { roleId: doomed.id } });
    await prisma.role.deleteMany({ where: { name: "TRANSPORT_MANAGER" } });
    await Promise.all(Array.from({ length: 20 }, () => seedRoles(prisma)));
    expect(await prisma.role.findUnique({ where: { name: "TRANSPORT_MANAGER" } })).not.toBeNull();
    expect(await prisma.role.count({ where: { name: "TRANSPORT_MANAGER" } })).toBe(1);
    // Restore the mappings this test removed — sibling files share this
    // database and must never observe a half-seeded role table.
    await seedPermissions(prisma);
  });

  it("seedPermissions survives parallel callers with mappings intact", async () => {
    const roleIds = (
      await prisma.role.findMany({ where: { name: { in: CANONICAL_ROLES } } })
    ).map((role) => role.id);
    const beforeMappings = await prisma.rolePermission.count({ where: { roleId: { in: roleIds } } });
    await Promise.all(
      Array.from({ length: 10 }, () => Promise.all([seedRoles(prisma), seedPermissions(prisma)])),
    );
    // Same scoped invariant, re-derived after the hammering: parallel
    // seedPermissions may recreate mappings, never duplicate them, and
    // sibling files' throwaway rows must not leak into the assertion.
    const afterRoleIds = (
      await prisma.role.findMany({ where: { name: { in: CANONICAL_ROLES } } })
    ).map((role) => role.id);
    expect(
      await prisma.rolePermission.count({ where: { roleId: { in: afterRoleIds } } }),
    ).toBe(beforeMappings);
    expect(await prisma.permission.count({ where: { key: "students.read" } })).toBe(1);
    const admin = await prisma.role.findUnique({ where: { name: "SCHOOL_ADMIN" } });
    const canMessage = await prisma.rolePermission.findFirst({
      where: { roleId: admin?.id ?? "", permission: { key: "messages.read" } },
    });
    expect(canMessage).not.toBeNull();
  });
});
