import { expect, test } from "@playwright/test";
import { ACCOUNTS, login } from "./helpers";

const API = process.env.E2E_API_URL ?? "http://localhost:4001";

// Super Admin panel end to end (§7 #23): owner nav across the four pages,
// suspend/reactivate + plan + invoice + mark-paid + user lifecycle, all on
// FRESH schools (never seed schools — suspending SOS/RK would break every
// other spec sharing this database).
test.describe("super admin panel", () => {
  test("nav exposes the pages; platform analytics stays Soon", async ({ page }) => {
    await login(page, ACCOUNTS.owner, null);
    await page.getByRole("link", { name: /open my board/i }).click();
    for (const label of ["Schools", "Subscriptions & Billing", "Users Management", "Audit Logs", "Settings"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
    // Platform Analytics has no page yet: sidebar shows it as dimmed text
    // with a Soon pill, never a dead link.
    await expect(page.getByRole("link", { name: "Platform Analytics" })).toHaveCount(0);
    await expect(page.getByText("Platform Analytics").first()).toBeVisible();
    // Sidebar geometry guard: grid auto-rows once stretched every link to
    // ~732px on long pages (only the top item stayed visible). Links must
    // stay compact — visibility asserts alone cannot catch it (Playwright
    // calls offscreen giants "visible").
    for (const label of ["Schools", "Audit Logs", "Settings"]) {
      const box = await page.getByRole("link", { name: label }).boundingBox();
      expect(box?.height ?? 9999).toBeLessThan(100);
    }
  });

  test("settings shows config status with no secrets", async ({ page }) => {
    await login(page, ACCOUNTS.owner, null);
    await page.getByRole("link", { name: /open my board/i }).click();
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Plan matrix").first()).toBeVisible();
    await expect(page.getByText("BASIC", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Demo mode").first()).toBeVisible();
    // Either state is honest; neither may leak key material.
    await expect(page.getByText(/TEST MODE|PAYMENTS UNCONFIGURED/).first()).toBeVisible();
    const bodyText = (await page.getByRole("main").first().textContent()) ?? "";
    expect(bodyText).not.toMatch(/rzp_test_/);
  });

  test("suspend/reactivate/plan cycle on a fresh school, audited", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const reg = await request.post(`${API}/api/v1/auth/register`, {
      data: {
        schoolName: `Owner Panel School ${stamp}`,
        adminName: "Owner Panel Admin",
        adminEmail: `owner-panel-${stamp}@example.com`,
        adminPassword: "password-123",
      },
    });
    expect(reg.ok()).toBe(true);
    const schoolId = ((await reg.json()) as { data: { school: { id: string } } }).data.school.id;
    const ownerLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: ACCOUNTS.owner, password: "Demo@1234" },
    });
    expect(ownerLogin.ok()).toBe(true);
    const ownerToken = ((await ownerLogin.json()) as { data: { accessToken: string } }).data.accessToken;

    await login(page, ACCOUNTS.owner, null);
    await page.getByRole("link", { name: /open my board/i }).click();
    await page.getByRole("link", { name: "Schools" }).click();
    await page.getByLabel(/search schools/i).fill(`Owner Panel School ${stamp}`);
    await expect(page.getByText(`Owner Panel School ${stamp}`).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Manage" }).click();
    // Reasonless first: the arm refuses with the reason error.
    await page.getByRole("button", { name: "Suspend" }).click();
    await expect(page.getByText(/reason is required/i).first()).toBeVisible();
    await page.getByLabel(/action reason/i).fill("E2E non-payment");
    await page.getByRole("button", { name: "Suspend" }).click();
    await page.getByRole("button", { name: "Confirm suspend" }).click();
    await expect(page.getByText("suspended.").first()).toBeVisible({ timeout: 20000 });

    // A successful action closes the panel — reopen it for the next one.
    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByLabel(/plan for/i).selectOption("PREMIUM");
    await page.getByLabel(/period start for/i).fill("2026-11-01");
    await page.getByLabel(/period end for/i).fill("2026-11-30");
    await page.getByLabel(/action reason/i).fill("E2E reactivation");
    await page.getByRole("button", { name: "Reactivate" }).click();
    await page.getByRole("button", { name: "Confirm reactivate" }).click();
    await expect(page.getByText("reactivated.").first()).toBeVisible({ timeout: 20000 });

    // Detail page: profile, usage, admins, and the audit trail carrying
    // the reasons above.
    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page.getByRole("heading", { name: `Owner Panel School ${stamp}` })).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("detail-usage")).toBeVisible();
    await expect(page.getByText("E2E non-payment").first()).toBeVisible();
    await expect(page.getByText("E2E reactivation").first()).toBeVisible();

    // The cycle left its trail on the platform audit trail (API-level:
    // the UI board shows the same rows, proven in the audit journey).
    const trail = await request.get(`${API}/api/v1/platform/audit-logs?schoolId=${schoolId}&take=10`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(trail.ok()).toBe(true);
    const actions = (((await trail.json()) as { data: { logs: { action: string }[] } }).data.logs).map((l) => l.action);
    expect(actions).toContain("SUBSCRIPTION_STATUS_CHANGE");
  });

  test("issue + mark-paid invoice journey on a fresh school", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const reg = await request.post(`${API}/api/v1/auth/register`, {
      data: {
        schoolName: `Owner Billing School ${stamp}`,
        adminName: "Owner Billing Admin",
        adminEmail: `owner-billing-${stamp}@example.com`,
        adminPassword: "password-123",
      },
    });
    expect(reg.ok()).toBe(true);
    const schoolName = `Owner Billing School ${stamp}`;

    await login(page, ACCOUNTS.owner, null);
    await page.getByRole("link", { name: /open my board/i }).click();
    await page.getByRole("link", { name: "Subscriptions & Billing" }).click();
    await page.getByLabel(/^school$/i).selectOption({ label: schoolName });
    await page.getByLabel(/^plan$/i).selectOption("BASIC");
    await page.getByLabel(/^period start$/i).fill("2026-11-01");
    await page.getByLabel(/^period end$/i).fill("2026-11-30");
    await page.getByRole("button", { name: "Issue invoice" }).click();
    await expect(page.getByText(/STY\/\d{2}-\d{2}\//).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Mark paid" }).first().click();
    await expect(page.getByText("re-activated").first()).toBeVisible({ timeout: 20000 });
    // Scoped to the invoice list: the status filter's own "Paid" option
    // also matches the text but is never visible.
    await expect(page.getByTestId("invoice-list").getByText("PAID").first()).toBeVisible();

    // A backdated PENDING invoice lands in the school-scoped overdue list;
    // the PAID filter then hides it again.
    await page.getByLabel(/^period start$/i).fill("2026-08-01");
    await page.getByLabel(/^period end$/i).fill("2026-08-31");
    await page.getByRole("button", { name: "Issue invoice" }).click();
    // The backdated invoice is overdue the moment the reload lands (the
    // heading starts at Overdue (0) — textContent never waits, so wait
    // for the change first).
    await expect(page.getByTestId("overdue-heading")).not.toContainText("Overdue (0)", { timeout: 20000 });
    const overdueNumber = await page.getByTestId("overdue-heading").textContent();
    expect(overdueNumber).toMatch(/Overdue \(([1-9]\d*)\)/);
    const overdueRow = page.locator("section", { has: page.getByTestId("overdue-heading") }).locator("li").first();
    await expect(overdueRow).toContainText(/STY\/\d{2}-\d{2}\//);
    const backdated = (await overdueRow.textContent())?.match(/STY\/\d{2}-\d{2}\/\d+/)?.[0] ?? "";
    expect(backdated).not.toBe("");
    await page.getByLabel(/status filter/i).selectOption("PAID");
    await expect(page.getByTestId("overdue-heading")).toContainText("Overdue (1)");
    await expect(page.getByTestId("invoice-list").getByText(backdated)).toHaveCount(0);
  });

  test("user deactivate/reactivate + role change on a fresh teacher", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const reg = await request.post(`${API}/api/v1/auth/register`, {
      data: {
        schoolName: `Owner Users School ${stamp}`,
        adminName: "Owner Users Admin",
        adminEmail: `owner-users-${stamp}@example.com`,
        adminPassword: "password-123",
      },
    });
    expect(reg.ok()).toBe(true);
    const regBody = (await reg.json()) as { data: { accessToken: string; school: { id: string }; user: { id: string } } };
    const teacherEmail = `owner-users-teacher-${stamp}@example.com`;
    const invite = await request.post(`${API}/api/v1/schools/${regBody.data.school.id}/staff`, {
      headers: { Authorization: `Bearer ${regBody.data.accessToken}` },
      data: { name: "Panel Teacher", email: teacherEmail, role: "TEACHER" },
    });
    expect(invite.ok()).toBe(true);

    await login(page, ACCOUNTS.owner, null);
    await page.getByRole("link", { name: /open my board/i }).click();
    await page.getByRole("link", { name: "Users Management" }).click();
    await page.getByLabel(/school filter/i).fill(regBody.data.school.id);
    await page.getByRole("button", { name: /^apply$/i }).click();
    await expect(page.getByText(teacherEmail).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Deactivate" }).first().click();
    await expect(page.getByText("deactivated").first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Reactivate" }).first().click();
    await expect(page.getByText("re-activated").first()).toBeVisible({ timeout: 20000 });
    await page.getByLabel(new RegExp(`Role for ${teacherEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)).selectOption("ACCOUNTANT");
    await page.getByRole("button", { name: "Set role" }).first().click();
    // Assert the exact notice string (unique on the page), not the bare
    // role word — the word also appears inside selects where getByText
    // matching is unreliable.
    await expect(page.getByText("Role changed to ACCOUNTANT.")).toBeVisible({ timeout: 20000 });

    // Name/email search narrows to the teacher; the reset link reports
    // honestly either way (sent, or created-but-undelivered when mail is
    // unset — the audit row lands regardless, proven API-side).
    await page.getByLabel(/search name or email/i).fill(teacherEmail);
    await page.getByRole("button", { name: /^apply$/i }).click();
    await expect(page.getByText(teacherEmail).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Send reset link" }).first().click();
    await expect(page.getByText(/reset link/i).first()).toBeVisible({ timeout: 20000 });
  });
});
