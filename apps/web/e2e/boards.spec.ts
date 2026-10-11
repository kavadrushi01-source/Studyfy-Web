import { expect, test } from "@playwright/test";
import { ACCOUNTS, SOS_SLUG, RK_SLUG, login } from "./helpers";

test.describe("student + parent boards", () => {
  test("Aditya sees own numbers; Suresh sees only Aditya", async ({ page }) => {
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/dashboard/student");
    await expect(page.getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });
    // E2e attendance marking moves the exact seeded % (83.3), so assert the
    // cards + a numeric % each, not frozen numbers.
    await expect(page.getByRole("main").getByText("Attendance", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText("Overall Marks", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(/^\d+(\.\d+)?%$/).first()).toBeVisible();
    await page.screenshot({ path: "e2e/shots/student-board.png" });

    await page.goto("/dashboard");
    await expect(page.getByText(/not for your role|forbidden|permission/i)).toBeVisible({ timeout: 20000 });

    await login(page, ACCOUNTS.sosParent, SOS_SLUG);
    await page.goto("/dashboard/parent");
    const selected = page.getByLabel(/child/i).locator("option:checked");
    await expect(selected).toContainText("Aditya Sharma", { timeout: 20000 });
    await expect(page.getByRole("main").getByText("Attendance", { exact: true })).toBeVisible();
    await page.screenshot({ path: "e2e/shots/parent-board.png" });
  });

  test("Krishna sees own board (RK mirror)", async ({ page }) => {
    await login(page, ACCOUNTS.rkStudent, RK_SLUG);
    await page.goto("/dashboard/student");
    await expect(page.getByText("Krishna Murthy").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("main").getByText("Attendance", { exact: true })).toBeVisible();
  });
});

test.describe("owner board", () => {
  test("sees both schools, computed revenue, admins denied", async ({ page }) => {
    await login(page, ACCOUNTS.owner, null);
    await page.goto("/dashboard/owner");
    // The schools table is newest-first and the e2e DB accumulates rows
    // across runs — search for the seed schools instead of assuming page-1
    // position (same rule as the roster and notice boards).
    await page.getByPlaceholder(/search name or slug/i).fill("School of Science");
    await expect(page.getByText("School of Science")).toBeVisible({ timeout: 20000 });
    await page.getByPlaceholder(/search name or slug/i).fill("Ramakrishna School");
    await expect(page.getByText("Ramakrishna School")).toBeVisible();
    // Revenue is COMPUTED from paid subscription invoices now (Chunk 2) —
    // seed invoices alone total ₹56,632.92, so assert a real formatted
    // amount, never a frozen zero.
    await expect(page.getByText(/₹[\d,]+\.\d{2}/).first()).toBeVisible();
    await page.screenshot({ path: "e2e/shots/owner-board.png" });

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/dashboard/owner");
    await expect(page.getByText(/not for your role|forbidden|permission|platform owner/i)).toBeVisible({ timeout: 20000 });
  });
});

test.describe("must-fail paths", () => {
  test("signed-out boards show the gate, never data", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText(/please sign in/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Kavita Rao")).toHaveCount(0);
  });

  test("garbage reset token fails identically twice", async ({ page }) => {
    for (let i = 0; i < 2; i++) {
      await page.goto("/reset-password");
      await page.getByLabel(/reset token/i).fill("never-existed-token-value-000000000000");
      await page.getByLabel(/^new password/i).fill("brand-new-password-456");
      await page.getByLabel(/confirm new password/i).fill("brand-new-password-456");
      await page.getByRole("button", { name: /update password/i }).click();
      await expect(page.getByText(/invalid or has expired/i)).toBeVisible({ timeout: 15000 });
    }
  });
});
