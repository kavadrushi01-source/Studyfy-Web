import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ACCOUNTS, OWNER_PASSWORD, SOS_SLUG, login, logout } from "./helpers";

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
      data: { email: ACCOUNTS.owner, password: OWNER_PASSWORD },
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
      data: { email: ACCOUNTS.owner, password: OWNER_PASSWORD },
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

  test("owner console: queue filters, priority move, both message kinds — school sees none of the internal", async ({
    page,
    request,
  }) => {
    const stamp = Date.now().toString(36);
    const adminEmail = `queue-e2e-${stamp}@example.com`;
    const reg = await request.post(`${API}/api/v1/auth/register`, {
      data: {
        schoolName: `Queue E2E School ${stamp}`,
        adminName: "Queue E2E Admin",
        adminEmail,
        adminPassword: "password-123",
      },
    });
    expect(reg.ok()).toBe(true);
    const regBody = (await reg.json()) as { data: { accessToken: string; school: { id: string; slug: string } } };
    const schoolId = regBody.data.school.id;
    const slug = regBody.data.school.slug;
    const adminHeaders = { Authorization: `Bearer ${regBody.data.accessToken}` };
    const highSubject = `Queue console high ${stamp}`;
    const lowSubject = `Queue console low ${stamp}`;
    const highRes = await request.post(`${API}/api/v1/schools/${schoolId}/support/tickets`, {
      headers: adminHeaders,
      data: { subject: highSubject, priority: "HIGH" },
    });
    expect(highRes.ok()).toBe(true);
    const highId = ((await highRes.json()) as { data: { id: string } }).data.id;
    const lowRes = await request.post(`${API}/api/v1/schools/${schoolId}/support/tickets`, {
      headers: adminHeaders,
      data: { subject: lowSubject, priority: "LOW" },
    });
    expect(lowRes.ok()).toBe(true);

    const ownerLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: ACCOUNTS.owner, password: OWNER_PASSWORD },
    });
    expect(ownerLogin.ok()).toBe(true);
    const ownerToken = ((await ownerLogin.json()) as { data: { accessToken: string } }).data.accessToken;
    const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };
    const noteBody = `Queue triage note ${stamp}`;
    const replyBody = `Queue visible reply ${stamp}`;
    await request
      .post(`${API}/api/v1/platform/tickets/${highId}/messages`, {
        headers: ownerHeaders,
        data: { body: noteBody, isInternal: true },
      })
      .then((r) => expect(r.ok()).toBe(true));
    await request
      .post(`${API}/api/v1/platform/tickets/${highId}/messages`, {
        headers: ownerHeaders,
        data: { body: replyBody, isInternal: false },
      })
      .then((r) => expect(r.ok()).toBe(true));

    // Owner console: both rows, then the queue filters narrow them.
    await login(page, ACCOUNTS.owner, null);
    await page.goto("/owner/support");
    const esc = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    await expect(page.getByRole("button", { name: esc(highSubject) })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: esc(lowSubject) })).toBeVisible();

    // Owner sees BOTH kinds inside the thread: amber INTERNAL pill + reply.
    await page.getByRole("button", { name: esc(highSubject) }).click();
    await expect(page.getByText("INTERNAL").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(noteBody).first()).toBeVisible();
    await expect(page.getByText(replyBody).first()).toBeVisible();

    // Priority filter: HIGH hides the LOW thread (and older runs' LOWs).
    await page.getByLabel(/filter priority/i).selectOption("HIGH");
    // Geometry guard (BUGSFIX-60): the select must show its label, not a
    // bare chevron — flex-basis:0 collapsed it once, screenshots caught it.
    const filterBox = await page.getByLabel(/filter priority/i).boundingBox();
    expect(filterBox?.width).toBeGreaterThan(80);
    await expect(page.getByRole("button", { name: esc(highSubject) })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: esc(lowSubject) })).toHaveCount(0);
    await page.getByLabel(/filter priority/i).selectOption("");

    // School-slug filter: bogus slug empties the queue honestly…
    await page.getByLabel(/filter school slug/i).fill(`no-such-school-${stamp}`);
    await page.getByRole("button", { name: /apply school/i }).click();
    await expect(page.getByText("No tickets").first()).toBeVisible({ timeout: 20000 });
    // …the run's own slug shows exactly its two threads…
    await page.getByLabel(/filter school slug/i).fill(slug);
    await page.getByRole("button", { name: /apply school/i }).click();
    await expect(page.getByRole("button", { name: esc(highSubject) })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: esc(lowSubject) })).toBeVisible();
    await expect(page.getByRole("button", { name: /Support E2E Subject/ })).toHaveCount(0);
    await page.getByRole("button", { name: /clear filters/i }).click();
    await expect(page.getByRole("button", { name: esc(lowSubject) })).toBeVisible({ timeout: 20000 });

    // Priority move rides a reply: LOW → HIGH, notice confirms.
    await page.getByRole("button", { name: esc(lowSubject) }).click();
    await page.getByLabel(/move priority/i).selectOption("HIGH");
    await page.getByLabel(/owner reply/i).fill(`Escalated for exams ${stamp}`);
    await page.getByRole("button", { name: /^send$/i }).click();
    await expect(page.getByText("Priority moved to HIGH").first()).toBeVisible({ timeout: 20000 });
    await logout(page);

    // School desk, same threads: both visible, ZERO internal surface —
    // no pill, no note body, only the public reply. Real admin login (like
    // the suspended test): the desk gates on user.role, a hand-built
    // session without it would land on the locked note instead.
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
    await expect(page.getByRole("button", { name: esc(highSubject) }).first()).toBeVisible({ timeout: 20000 });
    // The list auto-selects the newest thread (the LOW one here) — open
    // the HIGH thread before asserting its contents.
    await page.getByRole("button", { name: esc(highSubject) }).first().click();
    await expect(page.getByText("INTERNAL")).toHaveCount(0);
    await expect(page.getByText(noteBody)).toHaveCount(0);
    await expect(page.getByText(replyBody).first()).toBeVisible();
    await logout(page);
  });

  test("owner impersonates the reporter, banner shows, write blocked, exit writes END", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const adminName = `Imp Journey Admin ${stamp}`;
    const adminEmail = `imp-journey-${stamp}@example.com`;
    const reg = await request.post(`${API}/api/v1/auth/register`, {
      data: {
        schoolName: `Imp Journey School ${stamp}`,
        adminName,
        adminEmail,
        adminPassword: "password-123",
      },
    });
    expect(reg.ok()).toBe(true);
    const regBody = (await reg.json()) as { data: { accessToken: string; school: { id: string; slug: string } } };
    const schoolId = regBody.data.school.id;
    const subject = `Impersonate me ${stamp}`;
    await request
      .post(`${API}/api/v1/schools/${schoolId}/support/tickets`, {
        headers: { Authorization: `Bearer ${regBody.data.accessToken}` },
        data: { subject, priority: "MEDIUM" },
      })
      .then((r) => expect(r.ok()).toBe(true));

    const ownerLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: ACCOUNTS.owner, password: OWNER_PASSWORD },
    });
    expect(ownerLogin.ok()).toBe(true);
    const ownerToken = ((await ownerLogin.json()) as { data: { accessToken: string } }).data.accessToken;
    const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };

    // Console: open the thread, reason comes pre-filled with the reference.
    await login(page, ACCOUNTS.owner, null);
    await page.goto("/owner/support");
    const esc = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    await expect(page.getByRole("button", { name: esc(subject) })).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: esc(subject) }).click();
    await expect(page.getByLabel(/impersonation reason/i)).toHaveValue(
      new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      { timeout: 20000 },
    );

    // Start: lands on the school desk wearing the admin's identity.
    // (Exact label — the thread subject itself contains "impersonate".)
    const impLabel = new RegExp(`Impersonate ${adminName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    await page.getByRole("button", { name: impLabel }).click();
    await expect(page).toHaveURL(/\/support$/, { timeout: 20000 });
    await expect(page.getByText(/Viewing as/).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/read-only/).first()).toBeVisible();
    await expect(page.getByText(adminName).first()).toBeVisible();
    await expect(page.getByRole("button", { name: esc(subject) }).first()).toBeVisible({ timeout: 20000 });

    // A write attempt surfaces the read-only refusal (API 403 → page error).
    await page.getByRole("button", { name: esc(subject) }).first().click();
    await page.getByLabel(/thread reply/i).fill(`Sneaky owner write ${stamp}`);
    await page.getByRole("button", { name: /^reply$/i }).click();
    await expect(page.getByText(/read-only/i).first()).toBeVisible({ timeout: 20000 });

    // Exit: END is written, overlay discarded, back on the console.
    await page.getByRole("button", { name: /^exit$/i }).click();
    await expect(page).toHaveURL(/\/owner\/support$/, { timeout: 20000 });
    await expect(page.getByText(/Viewing as/)).toHaveCount(0);

    const logs = await request.get(`${API}/api/v1/platform/audit-logs?action=IMPERSONATION_END&schoolId=${schoolId}`, {
      headers: ownerHeaders,
    });
    expect(logs.ok()).toBe(true);
    const rows = ((await logs.json()) as { data: { logs: { action: string; entityId: string }[] } }).data.logs;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("IMPERSONATION_END");
    expect(typeof rows[0]?.entityId).toBe("string");
    await logout(page);
  });
});
