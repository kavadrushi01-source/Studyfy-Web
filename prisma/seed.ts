// Global role seed — the fixed set from spec §5/§9.1, seeded ONCE for the
// whole platform (never per-school). Permissions + role_permissions rows
// land with the RBAC middleware box; auth only needs the role rows.
// Idempotent (upsert by unique name) — safe to re-run.
// Run: npm run db:seed  (from the repo root; DATABASE_URL from env)
// The two demo schools + their data are a SEPARATE later box (DEMO_DATA.md)
// that extends this file — it must not replace the role seed below.
import { PrismaClient } from "@prisma/client";

const ROLES: { name: string; description: string }[] = [
  { name: "PLATFORM_OWNER", description: "Cross-tenant platform owner (no school_id)" },
  { name: "SCHOOL_ADMIN", description: "Full configuration within one school" },
  { name: "TEACHER", description: "Assigned classes/sections only" },
  { name: "ACCOUNTANT", description: "Fee collection and financial reports" },
  { name: "STUDENT", description: "Own records only (row-level self-scope)" },
  { name: "PARENT", description: "Linked children's records only (row-level self-scope)" },
  { name: "LIBRARIAN", description: "Library module (Phase 2)" },
  { name: "TRANSPORT_MANAGER", description: "Transport module (Phase 2)" },
];

export async function seedRoles(db: PrismaClient): Promise<string[]> {
  const names: string[] = [];
  for (const role of ROLES) {
    const row = await db.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
    names.push(row.name);
  }
  return names;
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("prisma/seed.ts");

if (invokedDirectly) {
  // No top-level await: this file must also run as CJS (repo root has no
  // "type": "module", so tsx compiles it to CJS).
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const names = await seedRoles(db);
    console.log(`Seeded roles: ${names.join(", ")}`);
  } finally {
    await db.$disconnect();
  }
}
