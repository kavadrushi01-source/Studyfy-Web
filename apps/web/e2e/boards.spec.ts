import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ACCOUNTS, SOS_SLUG, RK_SLUG, login, logout } from "./helpers";

const API = process.env.E2E_API_URL ?? "http://localhost:4001";

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

    // /dashboard redirects every non-admin role to the board it owns
    // (BUGSFIX 83) — a pupil never sees the admin shell at all.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/student/, { timeout: 20000 });

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
    // amount, never a frozen zero — plus the TEST/MANUAL split legs.
    await expect(page.getByText(/₹[\d,]+\.\d{2}/).first()).toBeVisible();
    await expect(page.getByText(/MANUAL ₹[\d,]+\.\d{2}/).first()).toBeVisible();
    await expect(page.getByText(/TEST ₹[\d,]+\.\d{2}/).first()).toBeVisible();
    // Platform Analytics (§16.1): revenue trend chart + status mix strip.
    await expect(page.getByRole("img", { name: /paid subscription revenue per month/i })).toBeVisible();
    await expect(page.getByTestId("status-mix")).toContainText(/Active/);
    await expect(page.getByTestId("status-mix")).toContainText(/Suspended/);
    await page.screenshot({ path: "e2e/shots/owner-board.png" });

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/dashboard/owner");
    await expect(page.getByText(/not for your role|forbidden|permission|platform owner/i)).toBeVisible({ timeout: 20000 });
  });
});

test.describe("must-fail paths", () => {
  // The demo banner is retired (founder call: trial/demo posture does not
  // belong in the portfolio UI) — the test now pins its ABSENCE on a demo
  // school AND a freshly registered real one.
  test("no demo banner anywhere: neither on demo schools nor on real ones", async ({ page, request }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/dashboard");
    await expect(page.getByText(/data resets nightly/i)).toHaveCount(0);
    await logout(page);

    // Fresh (real) school: no banner.
    const stamp = Date.now().toString(36);
    const adminEmail = `banner-${stamp}@example.com`;
    const reg = await request.post(`${API}/api/v1/auth/register`, {
      data: {
        schoolName: `Banner School ${stamp}`,
        adminName: "Banner Admin",
        adminEmail,
        adminPassword: "password-123",
      },
    });
    expect(reg.ok()).toBe(true);
    const regBody = (await reg.json()) as { data: { school: { slug: string } } };
    const slug = regBody.data.school.slug;
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
    await page.goto("/dashboard");
    await expect(page.getByText(/Billing|Students|Dashboard/).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/data resets nightly/i)).toHaveCount(0);
    await logout(page);
  });

  test("school settings hosts the export action; staff get the gate note", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const adminEmail = `settings-${stamp}@example.com`;
    const reg = await request.post(`${API}/api/v1/auth/register`, {
      data: {
        schoolName: `Settings School ${stamp}`,
        adminName: "Settings Admin",
        adminEmail,
        adminPassword: "password-123",
      },
    });
    expect(reg.ok()).toBe(true);
    const regBody = (await reg.json()) as { data: { school: { slug: string } } };
    const slug = regBody.data.school.slug;
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
    // Sidebar links in; the page gates itself.
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible({ timeout: 20000 });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(slug).first()).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.getByRole("button", { name: /download export/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const path = await download.path();
    expect(readFileSync(path).subarray(0, 2).toString()).toBe("PK");
    await logout(page);

    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/settings");
    await expect(page.getByText(/live with the school admin/i).first()).toBeVisible({ timeout: 20000 });
    await logout(page);
  });

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
