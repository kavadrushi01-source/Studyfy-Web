// Studyfy seed — roles (global, once) + two demo schools (DEMO_DATA.md).
// Idempotent: every row is upserted / find-first-skipped on a unique key,
// so re-running never duplicates and screenshots stay consistent run to run.
// All transactional values are DETERMINISTIC (index-derived, no randomness)
// for the same reason — DEMO_DATA.md demands reusable demos, not variety.
//
// Passwords: EVERY seeded account uses the shared demo password below.
// This is deliberately NOT §13.3's random-password flow — that rule protects
// REAL schools' REAL accounts; seed data exists so a human can log in as
// each role and verify by hand. Never reuse this pattern for real imports.
//
// Run: npm run db:seed  (DATABASE_URL from env; locally with
//   NODE_ENV=development, which selects the documented Demo@1234 fallback).
// Rotate demo passwords only:
//   npm run db:reset-demo-passwords  (DEMO_PASSWORD required in env —
//   password manager → shell, never committed; touches passwordHash rows in
//   isDemo schools + the seeded owner, nothing else).
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Parallel vitest workers share one database, so every global seed below
// must survive concurrent identical callers. Two failure modes, both seen
// for real (CI runs 35725384214, 35611906623; local worst-case hammering):
// - P2002 unique violation: upsert() is SELECT-then-INSERT, so two workers
//   INSERT the same key. Fixed with single-statement INSERT IGNORE
//   (createMany+skipDuplicates), which cannot race with itself.
// - P2034 deadlock: concurrent writers on the same rows. Fixed with a
//   bounded retry — every writer sets IDENTICAL values (fixed constant
//   lists), so a retry after a lost race always converges. Retry ONLY these
//   two codes; anything else throws immediately, never masked.
async function seedWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === "P2002" || err.code === "P2034")
      ) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

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
  // Race-safe under parallel callers — see seedWithRetry above.
  return seedWithRetry(async () => {
    await db.role.createMany({ data: ROLES, skipDuplicates: true });
    for (const role of ROLES) {
      await db.role.updateMany({ where: { name: role.name }, data: { description: role.description } });
    }
    return ROLES.map((role) => role.name);
  });
}

// ---------------------------------------------------------------------------
// Permissions — the OTHER half of RBAC (RULES.md §6). Like roles: global,
// seeded once, never per-school. Each Phase 1 module adds its keys in the
// SAME commit that first enforces them; this box seeds only what the
// current routes check (students.read, platform.schools.read).
// ---------------------------------------------------------------------------

const PERMISSIONS: { key: string; description: string }[] = [
  { key: "students.read", description: "List and read student records (row-narrowed by self-scope for STUDENT/PARENT)" },
  { key: "students.write", description: "Admit and edit students (School Admin, Accountant)" },
  { key: "sections.read", description: "List classes/sections and assignments" },
  { key: "sections.write", description: "Assign class teachers to sections (School Admin)" },
  { key: "attendance.mark", description: "Mark attendance (class teacher of the section, School Admin)" },
  { key: "attendance.read", description: "Read attendance summaries (row-narrowed by self-scope for STUDENT/PARENT)" },
  { key: "notices.read", description: "Read notices (students/parents see school-wide + own class/section only)" },
  { key: "notices.write", description: "Publish notices (School Admin, Teacher)" },
  { key: "fees.manage", description: "Create fee structures, record payments (School Admin, Accountant)" },
  { key: "fees.read", description: "Read invoices and ledgers (staff; students/parents narrowed to own)" },
  { key: "exams.manage", description: "Create exams and link subjects (School Admin, Teacher)" },
  { key: "exams.read", description: "Read exam schedules (all school roles)" },
  { key: "staff.manage", description: "Manage staff setup incl. teacher qualifications (School Admin)" },
  { key: "messages.send", description: "Send 1:1 academic messages (Teacher, Parent, Student — relationship-scoped)" },
  { key: "messages.read", description: "Read own conversations (Admin reads any as oversight)" },
  { key: "timetable.manage", description: "Generate timetables (School Admin)" },
  { key: "timetable.read", description: "Read timetable boards (scoped: own section / own slots)" },
  { key: "homework.manage", description: "Post homework (teacher of the subject/section, School Admin)" },
  { key: "homework.read", description: "Read homework boards (role-shaped: own/section/authored)" },
  { key: "homework.submit", description: "Submit homework (own section's assignments, Students only)" },
  { key: "homework.grade", description: "Grade submissions (teacher of the subject/section, School Admin)" },
  { key: "documents.read", description: "Read uploaded documents (staff; students/parents narrowed to own)" },
  { key: "documents.write", description: "Upload admission documents (School Admin, Accountant)" },
  { key: "crm.read", description: "Read the admission enquiry pipeline (School Admin, Accountant)" },
  { key: "crm.manage", description: "Work the pipeline: statuses, assignees, follow-up notes (School Admin)" },
  { key: "certificates.read", description: "Read issued certificates (School Admin, Accountant)" },
  { key: "certificates.manage", description: "Issue certificates (School Admin, Accountant)" },
  { key: "library.read", description: "Browse the catalog and read loans (all school roles; pupils/parents narrowed to own)" },
  { key: "library.manage", description: "Manage books, issue and take returns (School Admin, Librarian)" },
  { key: "transport.read", description: "Read routes, vehicles and assignments (all school roles; pupils/parents narrowed to own)" },
  { key: "transport.manage", description: "Manage routes, stops, vehicles and assignments (School Admin, Transport Manager)" },
  { key: "payroll.read", description: "Read payroll (managers see all; staff see own slips only)" },
  { key: "payroll.manage", description: "Set salaries, generate months, mark paid (School Admin, Accountant)" },
  { key: "inventory.read", description: "Browse stock items and movements (office roles)" },
  { key: "inventory.manage", description: "Manage items and record stock in/out (School Admin)" },
  { key: "dashboard.read", description: "Read own role's dashboard bundle (each board's route additionally role-guards its audience)" },
  { key: "platform.schools.read", description: "List every school cross-tenant (Platform Owner only)" },
  { key: "platform.billing.manage", description: "Suspend/reactivate schools, set plans, extend trials, issue invoices, mark paid (Platform Owner only)" },
  { key: "platform.users.read", description: "List user accounts across schools (Platform Owner only; account administration, never academic data)" },
  { key: "platform.users.manage", description: "Deactivate/reactivate accounts and change roles (Platform Owner only; never Platform Owner assignments)" },
  { key: "billing.read", description: "Read own school subscription and invoices; pay outstanding invoices (School Admin)" },
  { key: "support.read", description: "Read own school's support tickets (School Admin; internal notes never shown)" },
  { key: "support.write", description: "Open support tickets and reply (School Admin; internal notes stay owner-only)" },
  { key: "exports.manage", description: "Export own school's data as ZIP (School Admin only; secrets excluded, audited, rate-limited)" },
  { key: "platform.tickets.read", description: "Read support tickets across all schools, internal notes included (Platform Owner only)" },
  { key: "platform.tickets.manage", description: "Reply (internal or visible), set status, close support tickets (Platform Owner only)" },
  { key: "platform.settings.read", description: "Read platform configuration status (Platform Owner only; booleans, never secret values)" },
  { key: "platform.impersonate", description: "Start/end read-only impersonation sessions as staff (Platform Owner only, §13.9)" },
  { key: "platform.readonly", description: "Mint read-only Platform Owner demo sessions (Platform Owner only, §13.11)" },
  { key: "audit.read", description: "Read own school's audit logs (School Admin only; Platform Owner uses platform.audit.read)" },
  { key: "platform.audit.read", description: "Read audit logs across all schools (Platform Owner only)" },
];

// Role -> permission keys. STUDENT/PARENT hold students.read because the
// PERMISSION grants access while self-scope narrows ROWS — holding the key
// never means seeing everyone.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  SCHOOL_ADMIN: ["students.read", "students.write", "sections.read", "sections.write", "attendance.mark", "attendance.read", "notices.read", "notices.write", "fees.manage", "fees.read", "exams.manage", "exams.read", "staff.manage", "timetable.manage", "timetable.read", "homework.manage", "homework.read", "homework.submit", "homework.grade", "messages.read", "documents.read", "documents.write", "crm.read", "crm.manage", "certificates.read", "certificates.manage", "library.read", "library.manage", "transport.read", "transport.manage", "payroll.read", "payroll.manage", "inventory.read", "inventory.manage", "dashboard.read", "audit.read", "billing.read", "support.read", "support.write", "exports.manage"],
  TEACHER: ["students.read", "sections.read", "attendance.mark", "attendance.read", "notices.read", "notices.write", "exams.manage", "exams.read", "timetable.read", "homework.manage", "homework.read", "homework.grade", "messages.send", "messages.read", "documents.read", "library.read", "transport.read", "payroll.read", "inventory.read", "dashboard.read", "support.read", "support.write"],
  ACCOUNTANT: ["students.read", "students.write", "sections.read", "attendance.read", "notices.read", "fees.manage", "fees.read", "exams.read", "timetable.read", "documents.read", "documents.write", "crm.read", "certificates.read", "certificates.manage", "payroll.read", "payroll.manage", "inventory.read", "dashboard.read", "support.read", "support.write"],
  STUDENT: ["students.read", "documents.read", "attendance.read", "notices.read", "fees.read", "exams.read", "timetable.read", "homework.submit", "homework.read", "messages.send", "messages.read", "library.read", "transport.read", "dashboard.read"],
  PARENT: ["students.read", "documents.read", "attendance.read", "notices.read", "fees.read", "exams.read", "timetable.read", "homework.read", "messages.send", "messages.read", "library.read", "transport.read", "dashboard.read"],
  LIBRARIAN: ["students.read", "library.read", "library.manage", "payroll.read", "dashboard.read", "support.read", "support.write"],
  TRANSPORT_MANAGER: ["students.read", "transport.read", "transport.manage", "payroll.read", "support.read", "support.write"],
  PLATFORM_OWNER: ["platform.schools.read", "platform.audit.read", "platform.billing.manage", "platform.users.read", "platform.users.manage", "platform.tickets.read", "platform.tickets.manage", "platform.settings.read", "platform.impersonate", "platform.readonly"],
};

export async function seedPermissions(db: PrismaClient): Promise<void> {
  // Same race-safety as seedRoles — see seedWithRetry above.
  return seedWithRetry(async () => {
    await db.permission.createMany({ data: PERMISSIONS, skipDuplicates: true });
    for (const permission of PERMISSIONS) {
      await db.permission.updateMany({
        where: { key: permission.key },
        data: { description: permission.description },
      });
    }
    const [roles, permissions] = await Promise.all([
      db.role.findMany({ select: { id: true, name: true } }),
      db.permission.findMany({ select: { id: true, key: true } }),
    ]);
    const roleIdByName = new Map(roles.map((role) => [role.name, role.id]));
    const permissionIdByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));
    const mappings: { roleId: string; permissionId: string }[] = [];
    for (const [roleName, keys] of Object.entries(ROLE_PERMISSIONS)) {
      const roleId = roleIdByName.get(roleName);
      if (!roleId) {
        throw new Error(`Role ${roleName} must be seeded before permissions.`);
      }
      for (const key of keys) {
        const permissionId = permissionIdByKey.get(key);
        if (!permissionId) {
          throw new Error(`Permission ${key} must be seeded before mappings.`);
        }
        mappings.push({ roleId, permissionId });
      }
    }
    await db.rolePermission.createMany({ data: mappings, skipDuplicates: true });
  });
}


// ---------------------------------------------------------------------------
// Demo content seeding now lives in @studyfy/demo-seed (§13.11 reset job
// needs it from compiled code; this file keeps the CLI + roles/permissions).
// Dual consumption, same pattern as plans.ts: tsx paths run the SOURCE,
// compiled consumers import the BUILT package. Re-exported below so
// existing importers (seed-password tests) keep working untouched.
// ---------------------------------------------------------------------------
import {
  DEMO_BCRYPT_COST,
  DEV_FALLBACK_PASSWORD,
  OWNER_EMAIL,
  SCHOOLS,
  decideDemoPassword,
  isLocalDatabaseUrl,
  seedDemo,
} from "../packages/demo-seed/src/index.js";

export {
  DEMO_BCRYPT_COST,
  DEV_FALLBACK_PASSWORD,
  OWNER_EMAIL,
  SCHOOLS,
  decideDemoPassword,
  isLocalDatabaseUrl,
  seedDemo,
};

// Password rotation without touching data (§13.11): rewrites ONLY the
// passwordHash of accounts that already exist inside demo schools
// (isDemo=true) plus the seeded platform owner — no creates, no updates to
// any other column, no other school reachable by construction (the
// isDemo filter is the guard; a bug here degrades to updating nobody,
// never to touching a real school). Idempotent: re-running with the same
// DEMO_PASSWORD converges to the same end state (one fresh hash per run —
// bcrypt salts — all verifying against the same password).
export interface ResetDemoPasswordsResult {
  schools: { slug: string; updated: number }[];
  ownerUpdated: boolean;
}

export async function resetDemoPasswords(db: PrismaClient, password: string): Promise<ResetDemoPasswordsResult> {
  const passwordHash = await bcrypt.hash(password, DEMO_BCRYPT_COST);
  const demoSchools = await db.school.findMany({ where: { isDemo: true }, select: { id: true, slug: true } });
  const schools: { slug: string; updated: number }[] = [];
  for (const school of demoSchools) {
    const updated = await db.user.updateMany({ where: { schoolId: school.id }, data: { passwordHash } });
    schools.push({ slug: school.slug, updated: updated.count });
  }
  const owner = await db.user.updateMany({
    where: { schoolId: null, email: OWNER_EMAIL },
    data: { passwordHash },
  });
  return { schools, ownerUpdated: owner.count > 0 };
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("prisma/seed.ts");
const resetPasswordsMode = process.argv.includes("--reset-demo-passwords");

if (invokedDirectly) {
  // No top-level await: this file must also run as CJS (repo root has no
  // "type": "module", so tsx compiles it to CJS).
  (resetPasswordsMode ? resetMain() : main()).catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

// Rotation entry point (production use — see the header comment and §13.11):
//   DATABASE_URL='<prod-uri>' npx tsx prisma/seed.ts --reset-demo-passwords
// with DEMO_PASSWORD in the environment (password manager → shell env, never
// a committed file, never a chat message). DEMO_PASSWORD is REQUIRED here —
// no fallback in any NODE_ENV: a rotation that silently fell back to the
// documented password would be worse than refusing.
async function resetMain(): Promise<void> {
  const password = process.env.DEMO_PASSWORD;
  if (!password) {
    console.error(
      "Refusing to reset demo passwords: DEMO_PASSWORD is not set. " +
        "Generate a strong password, store it in your password manager (and the host's env vars), " +
        "then re-run with DEMO_PASSWORD in the environment. There is no fallback in this mode.",
    );
    process.exitCode = 1;
    return;
  }
  const db = new PrismaClient();
  try {
    const result = await resetDemoPasswords(db, password);
    for (const school of result.schools) {
      console.log(`Reset ${school.updated} demo password(s): ${school.slug}`);
    }
    console.log(`Seeded owner ${OWNER_EMAIL}: ${result.ownerUpdated ? "password reset" : "not found (nothing to do)"}`);
    console.log("Demo passwords rotated. Verify: log in with the new password; the old documented password must now fail.");
  } finally {
    await db.$disconnect();
  }
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const names = await seedRoles(db);
    console.log(`Seeded roles: ${names.join(", ")}`);
    await seedPermissions(db);
    console.log(`Seeded permissions: ${PERMISSIONS.map((p) => p.key).join(", ")}`);
    await seedDemo(db);
    console.log(`Seeded demo schools: ${SCHOOLS.map((s) => s.slug).join(", ")} + owner ${OWNER_EMAIL}`);
    // The VALUE never prints: deploy logs are not a password manager. The
    // source does, so an environment-sourced production password is
    // distinguishable from the development fallback in the log (§13.11).
    const fromEnv = Boolean(process.env.DEMO_PASSWORD);
    console.log(`Demo password source: ${fromEnv ? "DEMO_PASSWORD (environment)" : "local fallback (DEMO_DATA.md) — development database only"}`);
  } finally {
    await db.$disconnect();
  }
}
