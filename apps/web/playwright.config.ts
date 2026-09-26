import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  fullyParallel: false,
  // This dev box regularly stalls mid-run (OneDrive/Defender churn, other
  // browsers at 60%+ CPU): a stalled request once held the admin dashboard
  // for 38s and took 4 tests down with it. One retry rides out environment
  // stalls; a genuine regression still fails both attempts.
  retries: 1,
  // Default would be cores/2 (=6 on a 12-thread dev box): that boot storm
  // of headless Chromium saturates a machine that is also running a real
  // browser + editor, and first-test logins blow the 45s timeout under the
  // contention. 4 keeps the parallelism without the stampede.
  workers: Number(process.env.E2E_WORKERS ?? 4),
  globalSetup: "./e2e/global-setup",
  use: {
    baseURL: process.env.E2E_WEB_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
});
