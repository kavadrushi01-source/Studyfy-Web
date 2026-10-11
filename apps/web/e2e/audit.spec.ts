import { expect, test } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SOS_SLUG, login } from "./helpers";

const API = process.env.E2E_API_URL ?? "http://localhost:4001";

// Audit logs end to end: enroll a device over the API (writes the audit
// row), then prove the admin board shows it and the teacher board refuses.
// Count-independent throughout — the e2e DB accumulates rows across runs,
// so every assertion is presence/shape/filtered, never an exact total.
test.describe("audit logs board", () => {
  test("admin enrolls a terminal, then sees its DEVICE_REGISTER row via the nav", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const loginRes = await request.post(`${API}/api/v1/auth/login`, {
      data: { schoolSlug: SOS_SLUG, email: ACCOUNTS.sosAdmin, password: PASSWORD },
    });
    expect(loginRes.ok()).toBe(true);
    const { accessToken: token, user } = (
      (await loginRes.json()) as {
        data: { accessToken: string; user: { schoolId: string } };
      }
    ).data;
    const deviceName = `E2E Audit Terminal ${stamp}`;
    const enroll = await request.post(`${API}/api/v1/schools/${user.schoolId}/biometric/devices`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: deviceName },
    });
    expect(enroll.ok()).toBe(true);

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    // Login lands on the "Open my board" interstitial, not the dashboard —
    // the sidebar (with the Audit Logs nav) only exists past it.
    await page.getByRole("link", { name: /open my board/i }).click();
    await page.getByRole("link", { name: "Audit Logs" }).click();
    await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/action filter/i).fill("DEVICE_REGISTER");
    await page.getByRole("button", { name: /^apply$/i }).click();
    await expect(page.getByText("DEVICE_REGISTER").first()).toBeVisible({ timeout: 20000 });
    // The stamped terminal's name lives in the row's snapshot detail.
    await page.getByRole("button", { name: "Detail" }).first().click();
    await expect(page.getByText(deviceName).first()).toBeVisible({ timeout: 20000 });
  });

  test("teacher gets the gate note, never the rows", async ({ page }) => {
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/audit-logs");
    await expect(page.getByText(/school admin/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("DEVICE_REGISTER")).toHaveCount(0);
  });
});
