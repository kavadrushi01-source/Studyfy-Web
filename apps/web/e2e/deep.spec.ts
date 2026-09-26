import { expect, test, type APIRequestContext } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SOS_SLUG, login } from "./helpers";

// Second wave: the parts the first suite never touched — homework submit +
// grade lifecycle, timetable generate + section/pupil lenses, report + ID
// cards, parent fee scoping, staff roster, slug-confusion logins, pupil
// notices. API calls use a real login over HTTP; every assertion lands on
// rendered UI. Run-order independent: unique stamps, delta-tolerant counts,
// seed-backed rows (Geometry Problems, PTM notice) that reseeds rebuild.
const API = process.env.E2E_API_URL ?? "http://localhost:4001";

async function apiLogin(request: APIRequestContext, email: string, slug: string | null) {
  const res = await request.post(`${API}/api/v1/auth/login`, {
    data: { ...(slug ? { schoolSlug: slug } : {}), email, password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    data: { accessToken: string; user: { schoolId: string } };
  };
  return { token: body.data.accessToken, schoolId: body.data.user.schoolId };
}

test.describe("homework lifecycle", () => {
  test("pupil submits the open worksheet; teacher grades a pending row", async ({ page, request }) => {
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/homework");
    const card = page.locator("article", { hasText: "Geometry Problems" });
    await expect(card).toBeVisible({ timeout: 20000 });
    await card.getByLabel(/answer for geometry problems/i).fill("E2E deep-check answers: constructions 1-6 done.");
    await card.getByRole("button", { name: /^submit/i }).click();
    await expect(page.getByText(/submitted/i).first()).toBeVisible({ timeout: 20000 });

    // Teacher side is order-proof: grade one pending row if any exists
    // (the seed keeps two per section, and runs above keep replenishing).
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/homework");
    const gradeBtns = page.getByRole("button", { name: /mark graded/i });
    await expect(page.getByText(/grade submissions/i)).toBeVisible({ timeout: 20000 });
    // The grade-section heading renders before the board list resolves, so
    // counting buttons straight away can read 0 mid-load and then wait for
    // an empty-state that never comes. Settle on either terminal state.
    const nothing = page.getByText("Nothing waiting for a grade right now.");
    await expect(nothing.or(gradeBtns.first())).toBeVisible({ timeout: 20000 });
    const before = await gradeBtns.count();
    if (before === 0) {
      await expect(nothing).toBeVisible();
    } else {
      await gradeBtns.first().click();
      await expect
        .poll(async () => page.getByRole("button", { name: /mark graded/i }).count(), { timeout: 20000 })
        .toBe(before - 1);
    }
    void request;
  });
});

test.describe("timetable", () => {
  test("generate places lessons; section board shows the grid", async ({ page, request }) => {
    const { token, schoolId } = await apiLogin(request, ACCOUNTS.sosAdmin, SOS_SLUG);
    const headers = { Authorization: `Bearer ${token}` };
    const sections = (await (
      await request.get(`${API}/api/v1/schools/${schoolId}/sections`, { headers })
    ).json()) as { data: { sections: { id: string; name: string; class: { name: string } }[] } };
    const subjects = (await (
      await request.get(`${API}/api/v1/schools/${schoolId}/subjects`, { headers })
    ).json()) as { data: { subjects: { id: string; name: string }[] } };
    const section = sections.data.sections.find((s) => s.class.name === "Grade 9" && s.name === "A");
    const maths = subjects.data.subjects.find((s) => s.name === "Mathematics");
    expect(section?.id).toBeTruthy();
    expect(maths?.id).toBeTruthy();
    const gen = await request.post(`${API}/api/v1/schools/${schoolId}/timetable/generate`, {
      headers,
      data: { demands: [{ sectionId: section?.id, subjectId: maths?.id, periodsPerWeek: 5 }] },
    });
    expect(gen.ok()).toBe(true);
    const genBody = (await gen.json()) as { data: { placed: unknown[] } };
    expect(genBody.data.placed.length).toBeGreaterThan(0);

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/timetable");
    await expect(
      page.locator('select[aria-label="Section"] option', { hasText: "Grade 9 · A" }),
    ).toBeAttached({ timeout: 20000 });
    await page.getByLabel("Section", { exact: true }).selectOption({ label: "Grade 9 · A" });
    await page.getByRole("button", { name: /^show$/i }).click();
    await expect(page.getByText("Period").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Mathematics").first()).toBeVisible();
    await page.screenshot({ path: "e2e/shots/timetable-grid.png" });
  });

  test("pupil reads own section board; anything else is refused", async ({ page, request }) => {
    // The picker itself is scoped: pupils hold timetable.read but not
    // sections.read, so the board-scope endpoint feeds them exactly their
    // own section — Grade 10 must not even be offered.
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/timetable");
    await expect(
      page.locator('select[aria-label="Section"] option', { hasText: "Grade 9 · A" }),
    ).toBeAttached({ timeout: 20000 });
    await expect(
      page.locator('select[aria-label="Section"] option', { hasText: "Grade 10" }),
    ).toHaveCount(0);
    await page.getByLabel("Section", { exact: true }).selectOption({ label: "Grade 9 · A" });
    await page.getByRole("button", { name: /^show$/i }).click();
    await expect(page.getByText("Period").first()).toBeVisible({ timeout: 20000 });

    // And the server pins it too: asking for 10-A over HTTP is a 403, not
    // another school's week.
    const admin = await apiLogin(request, ACCOUNTS.sosAdmin, SOS_SLUG);
    const sections = (await (
      await request.get(`${API}/api/v1/schools/${admin.schoolId}/sections`, {
        headers: { Authorization: `Bearer ${admin.token}` },
      })
    ).json()) as { data: { sections: { id: string; name: string; class: { name: string } }[] } };
    const tenA = sections.data.sections.find((s) => s.class.name === "Grade 10" && s.name === "A");
    expect(tenA?.id).toBeTruthy();
    const pupil = await apiLogin(request, ACCOUNTS.sosStudent, SOS_SLUG);
    const denied = await request.get(
      `${API}/api/v1/schools/${pupil.schoolId}/timetable?sectionId=${tenA?.id}`,
      { headers: { Authorization: `Bearer ${pupil.token}` } },
    );
    expect(denied.status()).toBe(403);
  });
});

test.describe("records + money scoping", () => {
  test("report card PDF opens and the ID card prints the roster data", async ({ page, request }) => {
    const { token, schoolId } = await apiLogin(request, ACCOUNTS.sosAdmin, SOS_SLUG);
    const headers = { Authorization: `Bearer ${token}` };
    const list = (await (
      await request.get(`${API}/api/v1/schools/${schoolId}/students?search=Aditya%20Sharma`, { headers })
    ).json()) as { data: { students: { id: string }[] } };
    const pupilId = list.data.students[0]?.id;
    const exams = (await (
      await request.get(`${API}/api/v1/schools/${schoolId}/exams`, { headers })
    ).json()) as { data: { exams: { id: string }[] } };
    const examId = exams.data.exams[0]?.id;
    expect(pupilId).toBeTruthy();
    expect(examId).toBeTruthy();

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto(`/students/${pupilId}/report`);
    await expect(page.getByRole("heading", { name: /report card/i })).toBeVisible({ timeout: 20000 });
    // Student comes from the route now; only the exam is picked from the
    // loaded dropdown (options arrive async with the exams list).
    const examSelect = page.getByRole("combobox", { name: "Exam" });
    await expect(examSelect.locator("option").nth(1)).toBeAttached({ timeout: 20000 });
    await examSelect.selectOption(examId ?? "");
    const [popup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 20000 }),
      page.getByRole("button", { name: /open report card pdf/i }).click(),
    ]);
    // Headless Chromium has no PDF viewer, so a blob-PDF window stays at
    // about:blank — assert the tab opened, the app did NOT report a block,
    // and the bytes served are a real PDF.
    expect(popup).toBeTruthy();
    await expect(page.getByText(/blocked the new tab/i)).toHaveCount(0);
    const pdf = await request.get(
      `${API}/api/v1/schools/${schoolId}/exams/${examId}/report-cards/${pupilId}`,
      { headers },
    );
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString("latin1")).toBe("%PDF");
    await popup.close();
    await page.screenshot({ path: "e2e/shots/report-card.png" });

    await page.goto(`/students/${pupilId}/id-card`);
    await expect(page.getByRole("heading", { name: /id card/i })).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/school name/i).fill("School of Science");
    await page.getByRole("button", { name: /load card/i }).click();
    await expect(page.getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/ADM-/).first()).toBeVisible();
  });

  test("parent fee ledger shows only their own child", async ({ page }) => {
    await login(page, ACCOUNTS.sosParent, SOS_SLUG);
    await page.goto("/fees");
    await expect(page.getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Priya Patel")).toHaveCount(0);
  });

  test("staff roster lists the qualified seed teachers", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/teachers");
    await expect(page.getByText("Arjun Mehta").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Sneha Iyer").first()).toBeVisible();
  });
});

test.describe("gates + notices", () => {
  test("slug confusion fails safe with the server message, never a crash", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/school slug/i).fill("ramakrishna-school");
    await page.getByLabel(/email/i).fill(ACCOUNTS.sosAdmin);
    await page.getByLabel(/^password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /^login$/i }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Cannot read properties")).toHaveCount(0);

    await page.getByLabel(/school slug/i).fill("no-such-school-at-all");
    await page.getByRole("button", { name: /^login$/i }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible({ timeout: 15000 });
  });

  test("pupil notices board carries the seeded meeting", async ({ page }) => {
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/notices");
    await expect(page.getByText("Parent-Teacher Meeting on Saturday").first()).toBeVisible({ timeout: 20000 });
  });
});
