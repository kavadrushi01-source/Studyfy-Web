import { expect, test, type APIRequestContext } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SOS_SLUG, login, logout } from "./helpers";

const API = process.env.E2E_API_URL ?? "http://localhost:4001";

async function apiLogin(request: APIRequestContext, email: string, slug: string | null) {
  const res = await request.post(`${API}/api/v1/auth/login`, {
    data: { ...(slug ? { schoolSlug: slug } : {}), email, password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { data: { accessToken: string; user: { schoolId: string } } };
  return { token: body.data.accessToken, schoolId: body.data.user.schoolId };
}

// Chunk 4 (§7 Phase 2 #14 + #15): the depot and the salary desk, driven
// like a human. Deterministic in any run order: every name carries a run
// stamp.
test.describe("transport depot", () => {
  test("admin builds a route with stops, fleets a bus, assigns a rider", async ({ page }) => {
    const stamp = Date.now().toString(36);
    const routeName = `E2E Loop ${stamp}`;
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/transport");
    await expect(page.getByText("Transport").first()).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/route name/i).fill(routeName);
    await page.getByRole("button", { name: /add route/i }).click();
    await expect(page.getByText(/route added/i).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: new RegExp(routeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();

    for (const [stop, time] of [["Depot", "07:00"], ["Market", "07:15"]] as const) {
      await page.getByLabel(/stop name/i).fill(`${stop} ${stamp}`);
      await page.getByLabel(/pickup time/i).fill(time);
      await page.getByRole("button", { name: /add stop/i }).click();
      await expect(page.getByText(new RegExp(`${stop} ${stamp}`)).first()).toBeVisible({ timeout: 20000 });
    }

    await page.getByLabel(/registration number/i).fill(`E2E-${stamp.slice(-6).toUpperCase()}`);
    await page.getByLabel(/seat capacity/i).fill("30");
    await page.getByLabel(/driver name/i).fill("E2E Driver");
    await page.getByRole("button", { name: /add vehicle/i }).click();
    await expect(page.getByText(/vehicle added to the fleet/i).first()).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/find pupil/i).fill("Aditya Sharma");
    await page.getByRole("button", { name: /find pupil/i }).click();
    await expect(page.getByLabel(/rider pupil/i).locator("option", { hasText: "Aditya Sharma" })).toBeAttached({
      timeout: 20000,
    });
    const pupilValue =
      (await page
        .getByLabel(/rider pupil/i)
        .locator("option", { hasText: "Aditya Sharma" })
        .first()
        .getAttribute("value")) ?? "";
    await page.getByLabel(/rider pupil/i).selectOption(pupilValue);
    await page.getByRole("button", { name: /assign rider/i }).click();
    await expect(page.getByText(/rider assigned/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/transport.png" });
  });

  test("parent sees only the child's ride", async ({ page }) => {
    await login(page, ACCOUNTS.sosParent, SOS_SLUG);
    await page.goto("/transport");
    await expect(page.getByText("Transport").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: /add route/i })).toHaveCount(0);
  });

  test("transport manager runs the depot", async ({ page }) => {
    await login(page, ACCOUNTS.sosTransport, SOS_SLUG);
    await page.goto("/transport");
    await expect(page.getByText("Transport").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: /add route/i })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /add vehicle/i })).toHaveCount(1);
  });
});

test.describe("payroll desk", () => {
  test("admin marks absences, computes the month, teacher sees own pay", async ({ page, request }) => {
    // Two full logins + compute + slip bytes: allow headroom under the
    // 4-worker parallel load (standalone it takes ~22s).
    test.setTimeout(90000);    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/payroll");
    await expect(page.getByText("Payroll").first()).toBeVisible({ timeout: 20000 });

    // Two unpaid absences for Arjun in 2026-10 (re-marking overwrites, so
    // reruns stay deterministic).
    const attSel = page.getByLabel(/attendance staffer/i);
    await expect(attSel.locator("option", { hasText: "Arjun Mehta" })).toBeAttached({ timeout: 20000 });
    await attSel.selectOption(
      (await attSel.locator("option", { hasText: "Arjun Mehta" }).first().getAttribute("value")) ?? "",
    );
    for (const day of ["2026-10-05", "2026-10-06"]) {
      await page.getByLabel(/attendance date/i).fill(day);
      await page.getByLabel(/attendance status/i).selectOption("ABSENT");
      await page.getByRole("button", { name: /^mark$/i }).click();
      await expect(page.getByText(/attendance marked/i).first()).toBeVisible({ timeout: 20000 });
    }

    // Compute: 2 unpaid × (30000/30) = 2000 off, net 28000.
    const paySel = page.getByLabel(/payroll staffer/i);
    await paySel.selectOption(
      (await paySel.locator("option", { hasText: "Arjun Mehta" }).first().getAttribute("value")) ?? "",
    );
    await page.getByLabel(/payroll month/i).fill("2026-10");
    await page.getByLabel(/base salary/i).fill("30000");
    await page.getByRole("button", { name: /compute payroll/i }).click();
    await expect(page.getByText(/payroll computed/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/net ₹28000\.00/).first()).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/rows month/i).fill("2026-10");
    await page.getByRole("button", { name: /^filter$/i }).click();
    // The "· base" phrasing is unique to the rows list (the breakdown
    // above it reads "2026-10: base", and select options stay hidden).
    await expect(page.getByText("Arjun Mehta · 2026-10 · base ₹30000.00").first()).toBeVisible({ timeout: 20000 });
    // Slip byte proof: the computed row downloads as a real PDF.
    const { token, schoolId } = await apiLogin(request, ACCOUNTS.sosAdmin, SOS_SLUG);
    const rowsRes = await request.get(`${API}/api/v1/schools/${schoolId}/payroll?month=2026-10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rowsBody = (await rowsRes.json()) as { data: { payroll: { id: string; staff: { name: string } }[] } };
    const arjunRow = rowsBody.data.payroll.find((r) => r.staff.name === "Arjun Mehta");
    expect(arjunRow).toBeTruthy();
    const slip = await request.get(`${API}/api/v1/schools/${schoolId}/payroll/${arjunRow!.id}/slip`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(slip.ok()).toBe(true);
    expect(slip.headers()["content-type"]).toContain("application/pdf");
    expect((await slip.body()).slice(0, 5).toString()).toBe("%PDF-");
    await page.screenshot({ path: "e2e/shots/payroll.png" });
    await logout(page);

    // The teacher sees the computed row, never the office desk.
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/payroll");
    await expect(page.getByText("Payroll").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: /compute payroll/i })).toHaveCount(0);
    await expect(page.getByText(/₹28000\.00/).first()).toBeVisible({ timeout: 20000 });
  });

  test("teacher files leave for self, admin approves", async ({ page }) => {
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/payroll");
    await expect(page.getByText("Payroll").first()).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/leave dates/i).fill("2026-10-20");
    await page.getByLabel(/leave reason/i).fill("E2E family event");
    await page.getByRole("button", { name: /request leave/i }).click();
    await expect(page.getByText(/leave requested/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("E2E family event").first()).toBeVisible({ timeout: 20000 });
    await logout(page);

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/payroll");
    await expect(page.getByText("Payroll").first()).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/leave status filter/i).selectOption("PENDING");
    await page.getByRole("button", { name: /filter leaves/i }).click();
    const row = page.locator("li", { hasText: "E2E family event" }).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.getByRole("button", { name: /approve/i }).click();
    await expect(page.getByText(/leave approved/i).first()).toBeVisible({ timeout: 20000 });
  });
});
