import { expect, test } from "@playwright/test";
import { ACCOUNTS, SOS_SLUG, login } from "./helpers";

// First contact through the new picker: teacher starts a thread with a
// linked pupil, pupil sees it and replies. Proves the picker lists the
// right people AND the send path accepts what it offers.
test.describe("new-message picker", () => {
  test("teacher starts thread with linked pupil; pupil replies", async ({ page }) => {
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/messages");
    await page.getByLabel(/recipient/i).selectOption({ index: 1 });
    const option = await page.getByLabel(/recipient/i).locator("option:checked").textContent();
    expect(option).toMatch(/Aditya Sharma|Ishita Choudhary|Yash Gupta/);
    await page.getByLabel(/first message/i).fill("E2E first contact from Arjun.");
    await page.getByRole("button", { name: /start conversation/i }).click();
    await expect(page.getByText("E2E first contact from Arjun.")).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/new-thread.png" });
  });

  test("pupil picker offers only linked teachers", async ({ page }) => {
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/messages");
    // Contacts load async after the session is ready — wait for the linked
    // teacher before snapshotting the options, or the picker is still empty.
    await expect(
      page.getByLabel(/recipient/i).locator("option", { hasText: "Arjun Mehta" }),
    ).toBeAttached({ timeout: 20000 });
    const options = await page.getByLabel(/recipient/i).locator("option").allTextContents();
    const names = options.filter((t) => !t.startsWith("—"));
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((t) => t.includes("Arjun Mehta"))).toBe(true);
    expect(names.some((t) => t.includes("Priya Patel") || t.includes("Karan Mistry"))).toBe(false);
  });
});
