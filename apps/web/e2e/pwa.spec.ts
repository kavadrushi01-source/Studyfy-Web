import { expect, test } from "@playwright/test";
import { ACCOUNTS, SOS_SLUG, login } from "./helpers";

// PWA/offline-first (§7 Phase 3 #20): installability metadata, service
// worker registration, cached revisits, and the offline fallback shell.
// Localhost is a secure context, so SW APIs work here exactly as in prod.
const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3000";

test.describe("PWA shell", () => {
  test("manifest is valid and its icons exist", async ({ request }) => {
    const manifest = await request.get(`${WEB}/manifest.webmanifest`);
    expect(manifest.ok()).toBe(true);
    const body = (await manifest.json()) as {
      name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string }[];
    };
    expect(body.name).toContain("Studyfy");
    expect(body.display).toBe("standalone");
    expect(body.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of body.icons) {
      const res = await request.get(`${WEB}${icon.src}`);
      expect(res.ok()).toBe(true);
    }
    const sw = await request.get(`${WEB}/sw.js`);
    expect(sw.ok()).toBe(true);
  });

  test("service worker registers and offline shows the fallback shell", async ({ page }) => {
    await page.goto("/login");
    // clients.claim() puts the first load under control once activated —
    // no reload needed, but the first load itself bypassed the worker, so
    // one more online visit is what actually populates the page cache.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /^login$/i })).toBeVisible({ timeout: 20000 });

    // A visited page survives going offline (runtime-cached navigation).
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByRole("button", { name: /^login$/i })).toBeVisible({ timeout: 20000 });

    // A never-visited route has no cached copy: the offline shell answers.
    await page.goto("/dashboard/owner");
    await expect(page.getByRole("heading", { name: /you are offline/i })).toBeVisible({ timeout: 20000 });

    // Back online: the real page loads again.
    await page.context().setOffline(false);
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /^login$/i })).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/pwa-offline.png" });
  });

  test("key screens open offline from last-fetched data", async ({ page }) => {
    // Pupil warms both screens online (populating the page + API caches
    // under SW control), then the same screens render with no connection.
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
    await page.goto("/timetable");
    await expect(
      page.locator('select[aria-label="Section"] option', { hasText: "Grade 9 · A" }),
    ).toBeAttached({ timeout: 20000 });
    await page.getByLabel("Section", { exact: true }).selectOption({ label: "Grade 9 · A" });
    await page.getByRole("button", { name: /^show$/i }).click();
    await expect(page.getByText("Period").first()).toBeVisible({ timeout: 20000 });
    await page.goto("/homework");
    await expect(page.locator("article", { hasText: "Geometry Problems" })).toBeVisible({ timeout: 20000 });

    await page.context().setOffline(true);

    // Homework board loads on mount: cached shell + cached API = full board.
    await page.goto("/homework");
    await expect(page.locator("article", { hasText: "Geometry Problems" })).toBeVisible({ timeout: 20000 });

    // Timetable needs its picker re-driven after reload (client state is
    // not cached); the board data underneath comes from the API cache.
    await page.goto("/timetable");
    await expect(
      page.locator('select[aria-label="Section"] option', { hasText: "Grade 9 · A" }),
    ).toBeAttached({ timeout: 20000 });
    await page.getByLabel("Section", { exact: true }).selectOption({ label: "Grade 9 · A" });
    await page.getByRole("button", { name: /^show$/i }).click();
    await expect(page.getByText("Period").first()).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/pwa-key-screens.png" });
    await page.context().setOffline(false);
  });
});
