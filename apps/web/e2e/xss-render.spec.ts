import { expect, test, type APIRequestContext } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SOS_SLUG, login, logout } from "./helpers";

const API = process.env.E2E_API_URL ?? "http://localhost:4001";

// TEMP Layer 1: stored XSS renders as inert text, never executes.
test.describe("stored xss renders as text", () => {
  test("script payloads in notices and ticket threads never fire", async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    let dialogFired = "";
    page.on("dialog", async (d) => {
      dialogFired = d.message();
      await d.dismiss();
    });

    const adminLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { schoolSlug: SOS_SLUG, email: ACCOUNTS.sosAdmin, password: PASSWORD },
    });
    expect(adminLogin.ok()).toBe(true);
    const adminToken = ((await adminLogin.json()) as { data: { accessToken: string } }).data.accessToken;
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const noticeTitle = `XSS notice <script>alert("xss-notice-${stamp}")</script>`;
    const notice = await request.post(`${API}/api/v1/schools/${await schoolIdOf(request, adminToken)}/notices`, {
      headers: adminHeaders,
      data: { title: noticeTitle, body: `Body <img src=x onerror=alert("xss-img-${stamp}")>`, target: "SCHOOL" },
    });
    expect(notice.ok()).toBe(true);

    const subject = `XSS thread <svg onload=alert("xss-ticket-${stamp}")>`;
    const ticket = await request.post(`${API}/api/v1/schools/${await schoolIdOf(request, adminToken)}/support/tickets`, {
      headers: adminHeaders,
      data: { subject, priority: "LOW" },
    });
    expect(ticket.ok()).toBe(true);
    const ticketId = ((await ticket.json()) as { data: { id: string } }).data.id;
    const replyBody = `Reply <script>alert("xss-reply-${stamp}")</script>`;
    await request
      .post(`${API}/api/v1/schools/${await schoolIdOf(request, adminToken)}/support/tickets/${ticketId}/messages`, {
        headers: adminHeaders,
        data: { body: replyBody },
      })
      .then((r) => expect(r.ok()).toBe(true));

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/notices");
    await expect(page.getByText(`alert("xss-notice-${stamp}")`).first()).toBeVisible({ timeout: 20000 });
    await page.goto("/support");
    const esc = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    await page.getByRole("button", { name: esc(subject) }).click();
    await expect(page.getByText(`alert("xss-reply-${stamp}")`).first()).toBeVisible({ timeout: 20000 });
    expect(dialogFired).toBe("");
    await logout(page);
  });
});

async function schoolIdOf(request: APIRequestContext, token: string): Promise<string> {
  const me = await request.get(`${API}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  expect(me.ok()).toBe(true);
  return (((await me.json()) as { data: { user: { schoolId: string } } }).data.user.schoolId);
}
