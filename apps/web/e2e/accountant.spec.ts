import { expect, test } from "@playwright/test";
import { ACCOUNTS, SOS_SLUG, login } from "./helpers";

test.describe("SOS accountant circuit", () => {
  test("board numbers, pay flow, receipt opens", async ({ page }) => {
    await login(page, ACCOUNTS.sosAccountant, SOS_SLUG);
    await page.goto("/dashboard/accountant");
    await expect(page.getByText("Vikram Solanki").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Total Collected")).toBeVisible();
    await page.screenshot({ path: "e2e/shots/accountant-board.png" });

    // Record a partial payment through the new counter UI. Small amount on
    // purpose: e2e runs share one DB and pay down the same invoices, so a
    // big fixed amount eventually exceeds the remaining due and fails.
    await page.goto("/fees");
    await expect(page.getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/unpaid invoice/i).selectOption({ index: 1 });
    await page.getByLabel(/amount/i).fill("50");
    await page.getByLabel(/method/i).selectOption("CASH");
    await page.getByRole("button", { name: /record payment/i }).click();
    await expect(page.getByText(/recorded/i)).toBeVisible({ timeout: 20000 });

    // Receipt viewer route opens for the just-paid invoice (it auto-opens
    // the PDF in a new tab; here we assert the route resolves for staff).
    await page.goto("/fees/payments");
    await expect(page.getByText("CASH").first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("link", { name: /open/i }).first().click();
    await expect(page).toHaveURL(/\/fees\/receipts\//, { timeout: 15000 });
    await expect(page.getByRole("heading", { name: /fee receipt/i })).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: "e2e/shots/payments.png" });
  });
});
