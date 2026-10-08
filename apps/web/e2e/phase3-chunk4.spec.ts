import { expect, test, type APIRequestContext } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SOS_SLUG, login } from "./helpers";

const API = process.env.E2E_API_URL ?? "http://localhost:4001";

async function apiAdmin(request: APIRequestContext): Promise<{ token: string; schoolId: string }> {
  const res = await request.post(`${API}/api/v1/auth/login`, {
    data: { schoolSlug: SOS_SLUG, email: ACCOUNTS.sosAdmin, password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { data: { accessToken: string; user: { schoolId: string } } };
  return { token: body.data.accessToken, schoolId: body.data.user.schoolId };
}

// Phase 3 Chunk 4: biometric terminals + inventory. Admin-only UIs backed
// by key-authed punch import and movement-only stock.
test.describe("SOS biometric + inventory circuit", () => {
  test("terminal enrolls with a once-shown key, maps a pupil, taps mark present", async ({
    page,
    request,
  }) => {
    const stamp = Date.now().toString(36);
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/attendance/devices");
    await expect(page.getByRole("heading", { name: /biometric terminals/i })).toBeVisible({ timeout: 20000 });

    await page.getByLabel("Terminal name").fill(`E2E Gate Unit ${stamp}`);
    await page.getByLabel("Terminal location").fill("Test gate");
    await page.getByRole("button", { name: /enroll terminal/i }).click();
    await expect(page.getByText(/copy this key into the terminal now/i)).toBeVisible({ timeout: 20000 });
    const deviceKey = ((await page.locator("code").first().textContent()) ?? "").trim();
    expect(deviceKey.startsWith("bio_")).toBe(true);
    await expect(page.getByText(`E2E Gate Unit ${stamp}`).first()).toBeVisible();

    await page.getByLabel("Search pupils").fill("Aditya Sharma");
    await page.getByRole("button", { name: /^search$/i }).click();
    await expect(page.getByLabel("Device ID for Aditya Sharma")).toBeAttached({ timeout: 20000 });
    await page.getByLabel("Device ID for Aditya Sharma").fill(`BIO-E2E-${stamp}`);
    // Scope the save to Aditya's row (other pupils may share the board).
    const row = page.locator("li", { hasText: "Aditya Sharma" });
    await row.getByRole("button", { name: /save mapping/i }).click();
    await expect(page.getByText(`Mapped to device ID BIO-E2E-${stamp}`).first()).toBeVisible({ timeout: 20000 });

    // A real terminal tap, replayed over HTTP with the device key.
    const { schoolId } = await apiAdmin(request);
    const punch = await request.post(`${API}/api/v1/schools/${schoolId}/attendance/device-punches`, {
      headers: { "x-device-key": deviceKey },
      data: { punches: [{ deviceUserId: `BIO-E2E-${stamp}`, timestamp: new Date().toISOString() }] },
    });
    expect(punch.ok()).toBe(true);
    expect(((await punch.json()) as { data: { marked: number } }).data.marked).toBe(1);

    // Suspended terminals stop tapping — scope to this run's card, since
    // earlier runs leave their own units on the board.
    const unit = page.locator("li", { hasText: `E2E Gate Unit ${stamp}` });
    await unit.getByRole("button", { name: /^suspend$/i }).click();
    await expect(page.getByText("Suspended").first()).toBeVisible({ timeout: 20000 });
    const denied = await request.post(`${API}/api/v1/schools/${schoolId}/attendance/device-punches`, {
      headers: { "x-device-key": deviceKey },
      data: { punches: [{ deviceUserId: `BIO-E2E-${stamp}`, timestamp: new Date().toISOString() }] },
    });
    expect(denied.status()).toBe(401);
    await page.screenshot({ path: "e2e/shots/biometric-devices.png" });
  });

  test("stock adds, moves, refuses over-draw, and explains itself in history", async ({ page }) => {
    const stamp = Date.now().toString(36);
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: /^inventory$/i })).toBeVisible({ timeout: 20000 });

    const itemName = `E2E Chalk ${stamp}`;
    await page.getByLabel("Item name").fill(itemName);
    await page.getByRole("button", { name: /add item/i }).click();
    await expect(page.getByText(itemName).first()).toBeVisible({ timeout: 20000 });

    const card = page.locator("li", { hasText: itemName });
    await card.getByLabel(`Quantity for ${itemName}`).fill("20");
    await card.getByRole("button", { name: /^stock in$/i }).click();
    await expect(page.getByText("Stocked in.")).toBeVisible({ timeout: 20000 });

    await card.getByLabel(`Quantity for ${itemName}`).fill("6");
    await card.getByRole("button", { name: /^stock out$/i }).click();
    await expect(page.getByText("Stocked out.")).toBeVisible({ timeout: 20000 });
    await expect(card.getByText("14 pcs").first()).toBeVisible({ timeout: 20000 });

    await card.getByLabel(`Quantity for ${itemName}`).fill("99");
    await card.getByRole("button", { name: /^stock out$/i }).click();
    await expect(page.getByText(/only 14 pcs on hand/i)).toBeVisible({ timeout: 20000 });

    await card.getByRole("button", { name: /^history$/i }).click();
    await expect(card.getByText(/term purchase|class 9|OUT 6|IN 20/i).first()).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/inventory.png" });
  });
});
