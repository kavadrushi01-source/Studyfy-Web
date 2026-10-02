import { expect, test } from "@playwright/test";
import { ACCOUNTS, SOS_SLUG, login } from "./helpers";

// Chunk 2 (§7 Phase 2 #16 + #17): the admissions pipeline and certificate
// issuing, driven like a human. Enquiries arrive via the public form;
// office staff work them; certificates issue as PDFs.
test.describe("admissions CRM", () => {
  test("public enquiry lands in the pipeline; admin works it to CONTACTED with a note", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const name = `E2E Parent ${stamp}`;
    const created = await request.post(`${process.env.E2E_API_URL}/api/v1/public/enquiries`, {
      data: {
        schoolSlug: SOS_SLUG,
        name,
        phone: "9000000001",
        message: "Admission for Grade 1 next year, please share the fee structure.",
      },
    });
    expect(created.ok()).toBeTruthy();

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/crm");
    await expect(page.getByText("Admissions").first()).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/search enquiries/i).fill(name);
    await page.getByRole("button", { name: /^filter$/i }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: /^open$/i }).first().click();
    await expect(page.getByText("Admission for Grade 1 next year").first()).toBeVisible({ timeout: 20000 });

    const note = `Called ${stamp} — visiting Saturday.`;
    await page.getByLabel(/follow-up note/i).fill(note);
    await page.getByRole("button", { name: /^add note$/i }).click();
    await expect(page.getByText(note).first()).toBeVisible({ timeout: 20000 });

    await page.getByRole("button", { name: /contacted/i }).click();
    await expect(page.getByText(/moved to contacted/i).first()).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/crm-pipeline.png" });
  });

  test("accountant reads the pipeline but gets no manage actions", async ({ page }) => {
    await login(page, ACCOUNTS.sosAccountant, SOS_SLUG);
    await page.goto("/crm");
    await expect(page.getByText("Admissions").first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: /^open$/i }).first().click();
    await expect(page.getByText(/timeline/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/read-only for your role/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^add note$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /contacted/i })).toHaveCount(0);
  });

  test("teacher has no CRM access at all", async ({ page }) => {
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/crm");
    await expect(page.getByText(/not for your role|forbidden|permission|sign in/i).first()).toBeVisible({ timeout: 20000 });
  });
});

test.describe("certificates", () => {
  test("admin issues a bonafide certificate; log shows it; PDF opens", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/certificates");
    await expect(page.getByText("Certificates").first()).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/search pupil/i).fill("Aditya Sharma");
    await page.getByRole("button", { name: /^search$/i }).click();
    await expect(page.getByLabel(/^pupil$/i).locator("option", { hasText: "Aditya Sharma" })).toBeAttached({ timeout: 20000 });
    const value = await page
      .getByLabel(/^pupil$/i)
      .locator("option", { hasText: "Aditya Sharma" })
      .first()
      .getAttribute("value");
    await page.getByLabel(/^pupil$/i).selectOption(value ?? "");
    await page.getByLabel(/certificate type/i).selectOption("BONAFIDE");
    const [popup] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 20000 }).catch(() => null),
      page.getByRole("button", { name: /issue & open pdf/i }).click(),
    ]);
    await expect(page.getByText(/issued cert\//i).first()).toBeVisible({ timeout: 20000 });
    // The PDF opens in a new tab (blob URL, like fee receipts); headless
    // Chromium has no PDF viewer, so the popup existing is the proof.
    expect(popup !== null).toBe(true);
    if (popup && !popup.isClosed()) {
      await popup.close();
    }
    await page.screenshot({ path: "e2e/shots/certificates.png" });
  });

  test("pupil has no certificates access at all", async ({ page }) => {
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/certificates");
    await expect(page.getByText(/not for your role|forbidden|permission|sign in/i).first()).toBeVisible({ timeout: 20000 });
  });
});
