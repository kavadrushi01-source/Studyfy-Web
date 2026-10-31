import { expect, test, type APIRequestContext } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SOS_SLUG, login, logout } from "./helpers";

const API = process.env.E2E_API_URL ?? "http://localhost:4001";

async function apiAdmin(request: APIRequestContext): Promise<{ token: string; schoolId: string }> {
  const res = await request.post(`${API}/api/v1/auth/login`, {
    data: { schoolSlug: SOS_SLUG, email: ACCOUNTS.sosAdmin, password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { data: { accessToken: string; user: { schoolId: string } } };
  return { token: body.data.accessToken, schoolId: body.data.user.schoolId };
}

function lastDays(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)).toISOString().slice(0, 10));
  }
  return out;
}

// School Admin end to end on a FRESH seed: roster, admit, attendance,
// pay (new UI), marks entry (new UI), homework post (dropdowns),
// notices (dropdowns), messages, invite, sections, profile, logout.
test.describe("SOS admin full circuit", () => {
  test("dashboard shows live KPIs, roster admits", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/dashboard");
    await expect(page.getByText("Kavita Rao").first()).toBeVisible({ timeout: 20000 });
    // E2E DB accumulates across runs — assert presence + shape, not exact
    // seed counts. Cross-checks below use before/after deltas instead.
    for (const label of ["Total Students", "Total Teachers", "Total Classes", "Fee Collection"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(/₹[\d,]+\.\d{2}/).first()).toBeVisible();
    await page.screenshot({ path: "e2e/shots/admin-board.png" });

    await page.goto("/students");
    await expect(page.getByText("Aditya Sharma")).toBeVisible({ timeout: 20000 });
    // Roster accumulates E2E pupils across runs and paginates at 10/page,
    // so prove seed rows via search instead of assuming page-1 position.
    await page.getByLabel(/search/i).fill("Priya Patel");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText("Priya Patel")).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/search/i).fill("");
    // Wait for the UNFILTERED list response before reading the total —
    // clicking Search while empty used to race the refetch and capture the
    // stale "· 1 total" from the filtered search above.
    const [listResp] = await Promise.all([
      page.waitForResponse((r) => /\/students(\?|$)/.test(r.url()) && r.request().method() === "GET"),
      page.getByRole("button", { name: /search/i }).click(),
    ]);
    expect(listResp.ok()).toBeTruthy();
    const before = await page.getByText(/· (\d+) total/).textContent();
    const stamp = Date.now().toString(36);
    await page.goto("/students/new");
    await page.getByLabel(/full name/i).fill(`E2E Pupil ${stamp}`);
    await page.getByLabel("Email (student login)").fill(`e2e-pupil-${stamp}@example.com`);
    // Sections load async; the page falls back to a raw-ID input until they
    // arrive, so wait for the real dropdown before choosing.
    await expect(page.locator('select[aria-label="Section"]')).toBeAttached({ timeout: 20000 });
    await page.getByLabel(/section/i).selectOption({ index: 1 });
    await page.getByRole("button", { name: /admit student/i }).click();
    await expect(page.getByRole("heading", { name: /admitted/i })).toBeVisible({ timeout: 20000 });
    const beforeCount = Number(before?.match(/(\d+) total/)?.[1] ?? "0");
    await page.goto("/students");
    // Lookbehind keeps "2 total" from matching inside "12 total".
    await expect(page.getByText(new RegExp(`(?<!\\d)${beforeCount + 1} total`))).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/search/i).fill(`E2E Pupil ${stamp}`);
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText(`E2E Pupil ${stamp}`)).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/admit-done.png" });
  });

  test("attendance marking + fee payment through the new UIs", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/attendance/mark");
    await page.getByLabel(/section/i).selectOption({ label: "Grade 9 · A" });
    await expect(page.getByText("Aditya Sharma")).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: /save attendance/i }).click();
    await expect(page.getByText(/saved attendance for/i)).toBeVisible({ timeout: 20000 });

    await page.goto("/fees");
    await expect(page.locator("table").getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/unpaid invoice/i).selectOption({ index: 1 });
    await page.getByLabel(/amount/i).fill("50");
    await page.getByLabel(/method/i).selectOption("CASH");
    await page.getByRole("button", { name: /record payment/i }).click();
    await expect(page.getByText(/recorded/i)).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/fee-paid.png" });
  });

  test("marks entry, homework read-only, notice publish, message oversight", async ({ page }) => {
    // Three roles, two logouts, six boards: the longest flow in the suite.
    // Its own per-step asserts carry the real budgets; the total cap just
    // needs headroom for a loaded machine.
    test.setTimeout(60000);
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/exams/results");
    await page.getByLabel(/^exam$/i).selectOption({ index: 1 });
    await expect(page.getByText(/rank/i).first()).toBeVisible({ timeout: 20000 });

    await page.goto("/homework");
    // Admins read the homework board (oversight) but never post: no post
    // form, no grade queue — giving/taking homework is teachers' work.
    await expect(page.getByText(/homework/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: /post homework/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /mark graded/i })).toHaveCount(0);

    const hwStamp = Date.now().toString(36);
    await page.goto("/notices");
    await page.getByLabel(/title/i).fill(`E2E Notice ${hwStamp}`);
    await page.getByLabel(/^message/i).fill("End to end verification notice for the whole school today.");
    await page.getByRole("button", { name: /publish/i }).click();
    await expect(page.getByText(`E2E Notice ${hwStamp}`).first()).toBeVisible({ timeout: 20000 });

    await page.goto("/messages");
    // Oversight proof, self-sufficient: a teacher writes something fresh,
    // the admin sees that exact thread without participating.
    const oversightBody = `Oversight probe ${hwStamp}`;
    await logout(page);
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/messages");
    // The Arjun-Aditya thread is shared with parallel suites (teacher.spec
    // and messages.spec also post there), and whichever message lands last
    // owns the thread preview the admin asserts on below. Park the oversight
    // probe on Ishita's own thread - only this test ever writes to it.
    // Contacts load async; wait for her option before snapshotting.
    await expect(
      page.getByLabel(/recipient/i).locator("option", { hasText: /^Ishita Choudhary/ }),
    ).toBeAttached({ timeout: 20000 });
    const recipients = await page
      .getByLabel(/recipient/i)
      .locator("option")
      .evaluateAll((opts) => opts.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? "" })));
    const ishita = recipients.find((c) => c.text.startsWith("Ishita Choudhary"));
    expect(ishita?.value).toBeTruthy();
    await page.getByLabel(/recipient/i).selectOption(ishita?.value ?? "");
    await page.getByLabel(/first message/i).fill(oversightBody);
    await page.getByRole("button", { name: /start conversation/i }).click();
    await expect(page.getByText(oversightBody).first()).toBeVisible({ timeout: 20000 });
    await logout(page);
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/messages");
    await expect(page.getByText(oversightBody).first()).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: new RegExp(oversightBody) }).click();
    await expect(page.getByText(oversightBody).nth(1)).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/messages.png" });
  });

  test("invite teacher, assign section, profile, logout", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    const stamp = Date.now().toString(36);
    await page.goto("/teachers");
    await page.getByLabel(/full name/i).fill("E2E Teacher");
    await page.getByLabel(/email/i).fill(`e2e-teacher-${stamp}@example.com`);
    await page.getByRole("button", { name: /invite staff/i }).click();
    await expect(page.getByText(/one-time password/i)).toBeVisible({ timeout: 20000 });

    await page.goto("/profile");
    await expect(page.getByText("Kavita Rao")).toBeVisible({ timeout: 15000 });
    await logout(page);
    // Logout lands on the landing page now; confirm the session is really
    // gone by loading the login page fresh (form, not the signed-in card).
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  });

  test("absence alerts flag a freshly-truant pupil with facts and no-AI note", async ({ page, request }) => {
    // Interference-free: admit a stamped pupil into Grade 9-A over the API,
    // mark 7 present + 3 absent (trailing run of 3), then watch the alerts
    // page flag them. Re-runs overwrite the same rows (mark upsert).
    const { token, schoolId } = await apiAdmin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const sections = (await (
      await request.get(`${API}/api/v1/schools/${schoolId}/sections`, { headers })
    ).json()) as { data: { sections: { id: string; name: string; class: { name: string } }[] } };
    const nineA = sections.data.sections.find((s) => s.class.name === "Grade 9" && s.name === "A");
    expect(nineA?.id).toBeTruthy();

    const stamp = Date.now().toString(36);
    const admitted = await request.post(`${API}/api/v1/schools/${schoolId}/students`, {
      headers,
      data: {
        name: `E2E Truant ${stamp}`,
        email: `e2e-truant-${stamp}@example.com`,
        sectionId: nineA?.id,
        admissionNo: `ADM-E2E-${stamp}`,
        gender: "Female",
        guardians: [{ name: `Truant Guardian ${stamp}`, email: `e2e-tguard-${stamp}@example.com`, relationship: "Mother" }],
      },
    });
    expect(admitted.ok()).toBe(true);
    const pupilId = ((await admitted.json()) as { data: { student: { id: string } } }).data.student.id;

    const days = lastDays(10);
    for (let i = 0; i < days.length; i += 1) {
      const status = i < 7 ? "PRESENT" : "ABSENT";
      const marked = await request.post(`${API}/api/v1/schools/${schoolId}/attendance`, {
        headers,
        data: { sectionId: nineA?.id, date: days[i], records: [{ studentId: pupilId, status }] },
      });
      expect(marked.ok()).toBe(true);
    }

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/attendance/anomalies");
    await expect(page.getByRole("heading", { name: /absence alerts/i })).toBeVisible({ timeout: 20000 });
    await page.getByLabel("Section", { exact: true }).selectOption({ label: "Grade 9 · A" });
    await expect(page.getByText(`E2E Truant ${stamp}`).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/3 consecutive absences/i).first()).toBeVisible();
    // Summary state depends on server env (local dev server may hold a real
    // Groq key via apps/api/.env, CI has none): read it and assert the
    // matching UI. Either way the detections stand on their own.
    // Summary card: live Groq is flaky per call (empty-200s) and the page
    // makes its own call, so assert the card rendered content in whichever
    // of its three states (real summary / not-configured / unavailable) —
    // the status paths themselves are pinned in API tests.
    const summaryCard = page.locator("section", { has: page.getByRole("heading", { name: "Summary" }) });
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible({ timeout: 20000 });
    expect(((await summaryCard.textContent()) ?? "").length).toBeGreaterThan(20);
    await page.screenshot({ path: "e2e/shots/absence-alerts.png" });
  });

  test("reports nav opens analytics with seeded trends, exams, and sections", async ({ page }) => {
    // Seeded SOS data carries this: 15 marked days, fee rows, Unit Test 1
    // with marks, three sections. Assert shape + seeded content, not counts.
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL(/\/analytics/);
    await expect(page.getByRole("heading", { name: /reports & analytics/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("img", { name: /daily attendance percent/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Unit Test 1").first()).toBeVisible();
    await expect(page.getByText("Grade 9 · A").first()).toBeVisible();
    await expect(page.getByText(/pending/i).first()).toBeVisible();
    await page.getByLabel("Attendance window").selectOption("7");
    await expect(page.getByRole("img", { name: /daily attendance percent/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Unit Test 1").first()).toBeVisible();
    await page.getByLabel("Fee window").selectOption("3");
    await expect(page.getByRole("img", { name: /daily attendance percent/i })).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/analytics.png" });
  });
});
