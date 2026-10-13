import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SOS_SLUG, login, logout } from "./helpers";

const API = process.env.E2E_API_URL ?? "http://localhost:4001";

// In-app support tickets end to end (§7 #27): a school thread with an
// owner reply + an internal note lands with ONLY the reply visible, and a
// suspended admin keeps the support desk. Unique subjects per run so
// repeats never collide with earlier runs' rows.
test.describe("support tickets", () => {
  test("open, owner reply + internal note, school sees only the reply", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const subject = `Support E2E Subject ${stamp}`;

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/support");
    await page.getByLabel(/ticket subject/i).fill(subject);
    await page.getByRole("button", { name: /open ticket/i }).click();
    await expect(page.getByText("Ticket opened").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible();

    const ownerLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: ACCOUNTS.owner, password: PASSWORD },
    });
    expect(ownerLogin.ok()).toBe(true);
    const ownerToken = ((await ownerLogin.json()) as { data: { accessToken: string } }).data.accessToken;
    const all = await request.get(`${API}/api/v1/platform/tickets`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(all.ok()).toBe(true);
    const tickets = ((await all.json()) as { data: { tickets: { id: string; subject: string }[] } }).data.tickets;
    const thread = tickets.find((t) => t.subject === subject);
    expect(thread).toBeDefined();
    await request
      .post(`${API}/api/v1/platform/tickets/${thread?.id ?? ""}/messages`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { body: `Visible reply ${stamp}`, isInternal: false },
      })
      .then((r) => expect(r.ok()).toBe(true));
    await request
      .post(`${API}/api/v1/platform/tickets/${thread?.id ?? ""}/messages`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
        data: { body: `Hidden note ${stamp}`, isInternal: true },
      })
      .then((r) => expect(r.ok()).toBe(true));

    await page.reload();
    await expect(page.getByText(`Visible reply ${stamp}`).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(`Hidden note ${stamp}`)).toHaveCount(0);

    // Screenshot attach with storage unconfigured (no CLOUDINARY_URL in any
    // e2e env, by design): the 503 surfaces honestly, and nothing is
    // half-created — the thread still shows exactly the one reply.
    const shotPath = join(tmpdir(), `support-shot-${stamp}.png`);
    writeFileSync(shotPath, Buffer.alloc(2048, 7));
    await page.locator('input[type="file"]').setInputFiles(shotPath);
    await page.getByRole("button", { name: /reply with screenshot/i }).click();
    await expect(page.getByText(/not configured/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(`Visible reply ${stamp}`).first()).toBeVisible();
    await expect(page.getByText(`support-shot-${stamp}.png`)).toHaveCount(0);
    await logout(page);
  });

  test("staff desk: teacher opens a thread, sees only their own", async ({ page }) => {
    const stamp = Date.now().toString(36);
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);

    // Staff nav board carries Support now (§8.4 canonical nav)…
    await page.goto("/dashboard/teacher");
    await page.getByRole("link", { name: "Support" }).click();
    await expect(page).toHaveURL(/\/support$/);
    // …and the desk says the list is the staff member's own, not the
    // whole school's (the API scopes list+detail to createdById).
    await expect(page.getByText(/threads you opened/i)).toBeVisible({ timeout: 20000 });

    const subject = `Teacher thread ${stamp}`;
    await page.getByLabel(/ticket subject/i).fill(subject);
    await page.getByRole("button", { name: /open ticket/i }).click();
    await expect(page.getByText("Ticket opened").first()).toBeVisible({ timeout: 20000 });

    // Own thread listed and auto-selected…
    await expect(page.getByRole("button", { name: new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible();
    // …while the admin's thread from the test above never appears here.
    await expect(page.getByText(/Support E2E Subject/)).toHaveCount(0);

    // Reply inside the own thread (list auto-selects the newest/only row).
    await page.getByLabel(/thread reply/i).fill(`From the lab ${stamp}`);
    await page.getByRole("button", { name: /^reply$/i }).click();
    await expect(page.getByText(`From the lab ${stamp}`).first()).toBeVisible({ timeout: 20000 });
    await logout(page);
  });

  test("suspended admin keeps the support desk", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const adminEmail = `support-e2e-${stamp}@example.com`;
    const reg = await request.post(`${API}/api/v1/auth/register`, {
      data: {
        schoolName: `Support E2E School ${stamp}`,
        adminName: "Support E2E Admin",
        adminEmail,
        adminPassword: "password-123",
      },
    });
    expect(reg.ok()).toBe(true);
    const regBody = (await reg.json()) as { data: { accessToken: string; school: { id: string; slug: string } } };
    const schoolId = regBody.data.school.id;
    const slug = regBody.data.school.slug;
    const subject = `Suspended Support ${stamp}`;
    await request
      .post(`${API}/api/v1/schools/${schoolId}/support/tickets`, {
        headers: { Authorization: `Bearer ${regBody.data.accessToken}` },
        data: { subject, priority: "HIGH" },
      })
      .then((r) => expect(r.ok()).toBe(true));

    const ownerLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: ACCOUNTS.owner, password: PASSWORD },
    });
    const ownerToken = ((await ownerLogin.json()) as { data: { accessToken: string } }).data.accessToken;
    await request.post(`${API}/api/v1/platform/schools/${schoolId}/suspend`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
      data: { reason: "E2E suspension" },
    });

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
    await page.goto("/support");
    await expect(page.getByRole("button", { name: new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first()).toBeVisible({
      timeout: 20000,
    });
    await page.getByLabel(/thread reply/i).fill(`Still stuck ${stamp}`);
    await page.getByRole("button", { name: /^reply$/i }).click();
    await expect(page.getByText(`Still stuck ${stamp}`).first()).toBeVisible({ timeout: 20000 });
    await logout(page);
  });
});
