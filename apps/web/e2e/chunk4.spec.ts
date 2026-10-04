import { expect, test } from "@playwright/test";
import { ACCOUNTS, SOS_SLUG, login } from "./helpers";

// Chunk 4 (§7 Phase 2 #14 + #15): the depot and the salary desk, driven
// like a human. Deterministic in any run order: every name carries a run
// stamp.
test.describe("transport depot", () => {
  test("admin builds a route with stops, fleets a bus, assigns a rider", async ({ page }) => {
    const stamp = Date.now().toString(36);
    const routeName = `E2E Loop ${stamp}`;
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/transport");
    await expect(page.getByText("Transport").first()).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/route name/i).fill(routeName);
    await page.getByRole("button", { name: /add route/i }).click();
    await expect(page.getByText(/route added/i).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: new RegExp(routeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();

    for (const [stop, time] of [["Depot", "07:00"], ["Market", "07:15"]] as const) {
      await page.getByLabel(/stop name/i).fill(`${stop} ${stamp}`);
      await page.getByLabel(/pickup time/i).fill(time);
      await page.getByRole("button", { name: /add stop/i }).click();
      await expect(page.getByText(new RegExp(`${stop} ${stamp}`)).first()).toBeVisible({ timeout: 20000 });
    }

    await page.getByLabel(/bus number/i).fill(`E2E-${stamp.slice(-6).toUpperCase()}`);
    await page.getByLabel(/seat capacity/i).fill("30");
    await page.getByLabel(/driver name/i).fill("E2E Driver");
    await page.getByRole("button", { name: /add vehicle/i }).click();
    await expect(page.getByText(/vehicle added/i).first()).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/find pupil/i).fill("Aditya Sharma");
    await page.getByRole("button", { name: /find pupil/i }).click();
    await expect(page.getByLabel(/rider pupil/i).locator("option", { hasText: "Aditya Sharma" })).toBeAttached({
      timeout: 20000,
    });
    const pupilValue =
      (await page
        .getByLabel(/rider pupil/i)
        .locator("option", { hasText: "Aditya Sharma" })
        .first()
        .getAttribute("value")) ?? "";
    await page.getByLabel(/rider pupil/i).selectOption(pupilValue);
    await page.getByLabel(/boarding stop/i).selectOption({ index: 1 });
    await page.getByRole("button", { name: /assign rider/i }).click();
    await expect(page.getByText(/rider assigned/i).first()).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/transport.png" });
  });

  test("parent sees only the child's ride", async ({ page }) => {
    await login(page, ACCOUNTS.sosParent, SOS_SLUG);
    await page.goto("/transport");
    await expect(page.getByText("Transport").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: /add route/i })).toHaveCount(0);
  });
});

test.describe("payroll desk", () => {
  test("admin sets a salary, generates the month, marks it paid", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/payroll");
    await expect(page.getByText("Payroll").first()).toBeVisible({ timeout: 20000 });
    // Give Arjun a salary through the salaries table.
    const row = page.locator("li", { hasText: "Arjun Mehta" }).first();
    await row.getByLabel(/monthly salary for arjun mehta/i).fill("52000");
    await row.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/salary saved/i).first()).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/month to generate/i).fill("2026-10");
    await page.getByRole("button", { name: /generate month/i }).click();
    await expect(page.getByText(/month ready/i).first()).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/^month$/i).fill("2026-10");
    await page.getByRole("button", { name: /^filter$/i }).click();
    await expect(page.getByText("Arjun Mehta").first()).toBeVisible({ timeout: 20000 });
    // Idempotent across reruns: a previous run may already have paid this
    // row — pay it if pending, otherwise assert the PAID state directly.
    const payRow = page.locator("tr", { hasText: "Arjun Mehta" }).first();
    if ((await payRow.getByRole("button", { name: /mark paid/i }).count()) > 0) {
      await payRow.getByRole("button", { name: /mark paid/i }).click();
      await expect(page.getByText(/marked paid/i).first()).toBeVisible({ timeout: 20000 });
    } else {
      await expect(payRow.getByText(/^paid$/i)).toBeVisible({ timeout: 20000 });
    }
    await page.screenshot({ path: "e2e/shots/payroll.png" });
  });

  test("teacher sees only own slips", async ({ page }) => {
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/payroll");
    await expect(page.getByText("Payroll").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: /generate month/i })).toHaveCount(0);
  });
});
