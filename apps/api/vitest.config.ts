import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Capped at 2 fork workers: at default parallelism the Prisma engine
    // intermittently dies on Windows dev boxes (empty engine responses, one
    // native crash seen) and bcrypt-heavy tests time out. The suite is
    // row-isolated, so this trades ~30s of speed for reliability — no test
    // semantics change. CI (Linux) never showed this; cap is harmless there.
    maxWorkers: 2,
    // Register/login tests hash bcrypt passwords and can exceed vitest's
    // 5s default on a loaded Windows box (demo-safety flaked at exactly 5s).
    // 20s is well under any real hang while absorbing bcrypt variance.
    testTimeout: 20000,
  },
});
