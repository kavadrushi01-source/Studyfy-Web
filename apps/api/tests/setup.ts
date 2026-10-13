// Vitest setup: point every test at the TEST database and seed global roles.
// - CI sets DATABASE_URL to the fresh studyfy_test service DB already.
// - Locally, apps/api/.env holds the DEV database, so TEST_DATABASE_URL
//   (also in .env) overrides it here. Tests must NEVER touch the dev DB.
// Setup files evaluate fully before any test file is imported, so this
// override is in place before the shared Prisma singleton is constructed
// (the singleton reads DATABASE_URL at construction).
import "dotenv/config";
import { afterAll, beforeAll } from "vitest";

const dbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("Set TEST_DATABASE_URL (local .env) or DATABASE_URL (CI) to the test MySQL database.");
}
process.env.DATABASE_URL = dbUrl;

if (!process.env.JWT_ACCESS_SECRET) {
  throw new Error("Set JWT_ACCESS_SECRET (local .env or CI env) to run API tests.");
}

// Tests NEVER touch real SMTP. dotenv just loaded apps/api/.env, which
// holds live credentials locally — CI has no .env, so its suite has always
// run unconfigured (callers treat MailerUnconfiguredError as log-and-
// continue). Strip the creds here so both environments match and no test
// can ever deliver mail for real: the test DB accumulates 1000+ throwaway
// platform-owner accounts, and every ticket open notifies all of them.
for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const) {
  delete process.env[key];
}

// Deterministic CORS origin for tests (mirrors .env.example's local value).
// Set BEFORE any test file builds the app, since applyCors reads it at
// createApp() time.
if (!process.env.FRONTEND_ORIGIN) {
  process.env.FRONTEND_ORIGIN = "http://localhost:3000";
}

let disconnect: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  // Dynamic imports: run AFTER the DATABASE_URL override above, so the
  // shared Prisma singleton connects to the test DB, not the dev DB.
  const { prisma } = await import("../src/lib/prisma.js");
  const { seedRoles, seedPermissions } = await import("../../../prisma/seed.js");
  await seedRoles(prisma);
  await seedPermissions(prisma);
  disconnect = async () => {
    await prisma.$disconnect();
  };
});

afterAll(async () => {
  await disconnect();
});
