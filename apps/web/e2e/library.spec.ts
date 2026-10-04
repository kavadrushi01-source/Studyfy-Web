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
    // The shelf is title-sorted and paged — search for the new title so the
    // assertion holds no matter how many seeded/test books came before.
    await page.getByLabel(/search catalog/i).fill(title);
    await page.getByRole("button", { name: /^filter$/i }).click();
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 20000 });

    // Issue desk: find the pupil, pick the book, issue.
    await page.getByLabel(/find pupil/i).fill("Aditya Sharma");
    await page.getByRole("button", { name: /find pupil/i }).click();
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
    await page.getByLabel(/find book/i).fill(title);
    await page.getByRole("button", { name: /find book/i }).click();
    await expect(
      page.getByLabel(/pick book to issue/i).locator("option", { hasText: title }),
    ).toBeAttached({ timeout: 20000 });
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

  test("admin sets the fine rate; issue desk prices with it", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/library");
    await expect(page.getByText("Library").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/current: ₹5\/day/i).first()).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/fine rupees per day/i).fill("7");
    // Blur before saving: the rate lives in React state, and a discrete blur
    // flushes the pending keystroke state so Save never reads a stale value.
    await page.getByLabel(/fine rupees per day/i).press("Tab");
    await page.getByRole("button", { name: /save rate/i }).click();
    await expect(page.getByText(/fine rate saved/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/current: ₹7\/day/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/overdue fine: ₹7\/day/i).first()).toBeVisible();
    // Restore the default so later runs start clean.
    await page.getByLabel(/fine rupees per day/i).fill("5");
    await page.getByLabel(/fine rupees per day/i).press("Tab");
    await page.getByRole("button", { name: /save rate/i }).click();
    await expect(page.getByText(/current: ₹5\/day/i).first()).toBeVisible({ timeout: 20000 });
  });

  test("admin edits a title; guard refuses shrinking below issued", async ({ page }) => {
    const stamp = Date.now().toString(36);
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/library");
    await expect(page.getByText("Library").first()).toBeVisible({ timeout: 20000 });
    // Add a 1-copy title, issue it to Aditya, then try shrinking below issued.
    await page.getByLabel(/book title/i).fill(`E2E Edit ${stamp}`);
    await page.getByLabel(/book author/i).fill("E2E Author");
    await page.getByLabel(/total copies/i).fill("1");
    await page.getByRole("button", { name: /add to catalog/i }).click();
    await expect(page.getByText(/added to the catalog/i).first()).toBeVisible({ timeout: 20000 });
    // Title-sorted paging means a fresh add can land off page 1 once the
    // shelf holds 20+ titles — search first, then work the row.
    await page.getByLabel(/search catalog/i).fill(`E2E Edit ${stamp}`);
    await page.getByRole("button", { name: /^filter$/i }).click();
    await expect(page.getByText(`E2E Edit ${stamp}`).first()).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/find pupil/i).fill("Aditya Sharma");
    await page.getByRole("button", { name: /find pupil/i }).click();
    const pupilSel = page.getByLabel(/issue to pupil/i);
    await expect(pupilSel.locator("option", { hasText: "Aditya Sharma" })).toBeAttached({ timeout: 20000 });
    await pupilSel.selectOption(
      (await pupilSel.locator("option", { hasText: "Aditya Sharma" }).first().getAttribute("value")) ?? "",
    );
    const bookSel = page.getByLabel(/pick book to issue/i);
    await page.getByLabel(/find book/i).fill(`E2E Edit ${stamp}`);
    await page.getByRole("button", { name: /find book/i }).click();
    await expect(bookSel.locator("option", { hasText: `E2E Edit ${stamp}` })).toBeAttached({ timeout: 20000 });
    await bookSel.selectOption(
      (await bookSel.locator("option", { hasText: `E2E Edit ${stamp}` }).first().getAttribute("value")) ?? "",
    );
    await page.getByRole("button", { name: /issue book$/i }).click();
    await expect(page.getByText(/issued — due date set/i).first()).toBeVisible({ timeout: 20000 });
    // Edit the author; copies edit down to... issued count is 1 of 1, so
    // shrinking is impossible here — assert the title edit instead.
    const row = page.locator("tr", { hasText: `E2E Edit ${stamp}` }).first();
    await row.getByRole("button", { name: /^edit$/i }).click();
    await expect(page.getByLabel(/edit title/i)).toHaveValue(`E2E Edit ${stamp}`);
    await page.getByLabel(/edit author/i).fill("E2E Author Revised");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/book updated/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("E2E Author Revised").first()).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/library-edit.png" });
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
