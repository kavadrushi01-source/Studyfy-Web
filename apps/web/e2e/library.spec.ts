import { expect, test } from "@playwright/test";
import { ACCOUNTS, SOS_SLUG, login } from "./helpers";

// Chunk 3 (§7 Phase 2 #13): the shelf end to end — catalog, issue desk,
// return, and the pupil's own loans. Deterministic in any run order: every
// title carries a run stamp.
test.describe("library circuit", () => {
  test("admin adds a title, issues it, takes it back; pupil sees only own loans", async ({ page }) => {
    const stamp = Date.now().toString(36);
    const title = `E2E Atlas ${stamp}`;

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/library");
    await expect(page.getByText("Library").first()).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/book title/i).fill(title);
    await page.getByLabel(/book author/i).fill("E2E Cartographer");
    await page.getByLabel(/total copies/i).fill("1");
    await page.getByRole("button", { name: /add to catalog/i }).click();
    await expect(page.getByText(/added to the catalog/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 20000 });

    // Issue desk: find the pupil, pick the book, issue.
    await page.getByLabel(/find pupil/i).fill("Aditya Sharma");
    await page.getByRole("button", { name: /^find$/i }).click();
    await expect(page.getByLabel(/issue to pupil/i).locator("option", { hasText: "Aditya Sharma" })).toBeAttached({
      timeout: 20000,
    });
    const pupilValue =
      (await page
        .getByLabel(/issue to pupil/i)
        .locator("option", { hasText: "Aditya Sharma" })
        .first()
        .getAttribute("value")) ?? "";
    await page.getByLabel(/issue to pupil/i).selectOption(pupilValue);
    const bookValue =
      (await page
        .getByLabel(/pick book to issue/i)
        .locator("option", { hasText: title })
        .first()
        .getAttribute("value")) ?? "";
    await page.getByLabel(/pick book to issue/i).selectOption(bookValue);
    await page.getByRole("button", { name: /issue book$/i }).click();
    await expect(page.getByText(/issued — due date set/i).first()).toBeVisible({ timeout: 20000 });

    // Shelf shows 0/1 and the loans board carries the open loan.
    await expect(page.getByText("0/1").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel(/filter loans by status/i).selectOption("ISSUED"));
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 20000 });

    // Return it: back to 1/1, loan flips to RETURNED.
    await page.getByRole("button", { name: /^return$/i }).first().click();
    await expect(page.getByText(/back on the shelf/i).first()).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/filter loans by status/i).selectOption("RETURNED");
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/library.png" });
  });

  test("pupil sees own loans, never the desk", async ({ page }) => {
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/library");
    await expect(page.getByText("Library").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/my loans/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: /add to catalog/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /issue book$/i })).toHaveCount(0);
  });
});
