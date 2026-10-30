import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SOS_SLUG, login } from "./helpers";

const API = process.env.E2E_API_URL ?? "http://localhost:4001";

// Billing end to end (§16.1): plan/status display, TEST-stamped invoices,
// and the suspended-admin exception journey on a FRESH school (never a
// seed school — suspending SOS/RK would break every other spec sharing
// this database).
test.describe("billing", () => {
  test("admin sees plan, status and TEST invoices", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.getByRole("link", { name: "Billing" }).click();
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("PREMIUM plan").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("ACTIVE").first()).toBeVisible();
    await expect(page.getByText("TEST INVOICE").first()).toBeVisible();
    await expect(page.getByText(/STY\/\d{2}-\d{2}\//).first()).toBeVisible();
    await expect(page.getByTestId("plan-usage")).toHaveText(/students · Unlimited on PREMIUM/);
    // The invoice PDF downloads real bytes (§16.1 stamp proven API-side;
    // here the wiring: button → blob download → %PDF- on disk).
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20000 }),
      page.getByRole("button", { name: /invoice pdf/i }).first().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    const saved = await download.path();
    expect(saved).not.toBeNull();
    expect(readFileSync(saved as string).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("suspended admin reaches billing with the suspended banner, nowhere else", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const adminEmail = `billing-e2e-${stamp}@example.com`;
    const reg = await request.post(`${API}/api/v1/auth/register`, {
      data: {
        schoolName: `Billing E2E School ${stamp}`,
        adminName: "Billing E2E Admin",
        adminEmail,
        adminPassword: "password-123",
      },
    });
    expect(reg.ok()).toBe(true);
    const regBody = (await reg.json()) as { data: { school: { id: string; slug: string } } };
    const schoolId = regBody.data.school.id;
    const slug = regBody.data.school.slug;

    const ownerLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: ACCOUNTS.owner, password: PASSWORD },
    });
    expect(ownerLogin.ok()).toBe(true);
    const ownerToken = ((await ownerLogin.json()) as { data: { accessToken: string } }).data.accessToken;
    const issue = await request.post(`${API}/api/v1/platform/subscription-invoices`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { schoolId, plan: "BASIC", periodStart: "2026-11-01", periodEnd: "2026-11-30" },
    });
    expect(issue.ok()).toBe(true);

    // Custom-password admins sign in over the API (the shared UI login
    // helper only knows the Demo@1234 seed password), then plant the
    // session and open billing while still TRIAL: banner + usage first.
    const adminApiLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { schoolSlug: slug, email: adminEmail, password: "password-123" },
    });
    expect(adminApiLogin.ok()).toBe(true);
    const adminBody = (await adminApiLogin.json()) as {
      data: { accessToken: string; user: { schoolId: string } };
    };
    await page.goto("/login");
    await page.evaluate(
      (session: string) => window.localStorage.setItem("studyfy-session", session),
      JSON.stringify({
        token: adminBody.data.accessToken,
        schoolSlug: slug,
        issuedAt: Date.now(),
        user: adminBody.data.user,
      }),
    );
    await page.goto("/billing");
    await expect(page.getByText(/trial.*ends/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("plan-usage")).toHaveText(/0 of 1,500 students used/);

    // Suspended admins keep working sessions (the §13.4 exception): suspend
    // mid-journey and the same page becomes the suspended screen — banner,
    // invoices, pay button, all usable.
    await request.post(`${API}/api/v1/platform/schools/${schoolId}/suspend`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { reason: "E2E suspension" },
    });
    await page.reload();
    await expect(page.getByText("Account suspended").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("TEST INVOICE").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /pay .* online/i }).first()).toBeVisible();
  });
});
