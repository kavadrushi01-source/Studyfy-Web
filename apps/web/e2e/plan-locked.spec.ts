import { expect, test } from "@playwright/test";
import { ACCOUNTS, RK_SLUG, SOS_SLUG, login, logout } from "./helpers";

// Plan-gate locked states side by side (§16.1): School of Science (Premium)
// sees everything; Ramakrishna (Standard) sees Phase 3 modules locked with
// an upgrade prompt — never hidden, never a bare error. Phase 2 stays open
// on Standard (library proves the other direction).
test.describe("plan locked states", () => {
  test("Ramakrishna Standard: Phase 3 locked, Phase 2 open", async ({ page }) => {
    await login(page, ACCOUNTS.rkAdmin, RK_SLUG);

    await page.goto("/analytics");
    await expect(page.getByTestId("module-locked")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/premium plan or higher/i).first()).toBeVisible();

    await page.goto("/inventory");
    await expect(page.getByTestId("module-locked")).toBeVisible({ timeout: 20000 });

    await page.goto("/library");
    await expect(page.getByTestId("module-locked")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^library$/i })).toBeVisible();

    await logout(page);
  });

  test("School of Science Premium: everything open", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);

    await page.goto("/analytics");
    await expect(page.getByTestId("module-locked")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /reports.*analytics/i })).toBeVisible();

    await page.goto("/inventory");
    await expect(page.getByTestId("module-locked")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /^inventory$/i })).toBeVisible();

    await logout(page);
  });
});
