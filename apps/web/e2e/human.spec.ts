import { expect, test } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SOS_SLUG, login, logout } from "./helpers.js";

const API = process.env.E2E_API_URL ?? "http://localhost:4001";

// Deep human-like pass: the things a careful person does that the flow
// specs don't - reopening a saved day, typing bad numbers, resizing the
// window, hammering Back after logout, clicking every menu item. Runs
// against the same seeded e2e DB as the rest of the suite.

test.describe("role journeys", () => {
  test("admitted pupil signs in with the one-time password", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/students/new");
    const stamp = Date.now().toString(36);
    const name = `E2E OneTime ${stamp}`;
    const email = `e2e-onetime-${stamp}@example.com`;
    await page.getByLabel(/full name/i).fill(name);
    await page.getByLabel("Email (student login)").fill(email);
    await expect(page.locator('select[aria-label="Section"]')).toBeAttached({ timeout: 20000 });
    await page.getByLabel(/section/i).selectOption({ index: 1 });
    await page.getByRole("button", { name: /admit student/i }).click();
    await expect(page.getByRole("heading", { name: /admitted/i })).toBeVisible({ timeout: 20000 });
    const tempPassword = (await page.locator("code").first().textContent())?.trim() ?? "";
    expect(tempPassword.length).toBeGreaterThan(5);

    await logout(page);
    await page.goto("/login");
    await page.getByLabel(/school slug/i).fill(SOS_SLUG);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password/i).fill(tempPassword);
    await page.getByRole("button", { name: /^login$/i }).click();
    await expect(page.getByText(/signed in as/i)).toBeVisible({ timeout: 20000 });
    // Login lands on the signed-in panel; the human path is its board link.
    await page.getByRole("link", { name: /open my board/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/student/, { timeout: 20000 });
    // The fresh account is a pupil: own board, own name, no staff pages.
    await page.goto("/profile");
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/school admin/i)).toHaveCount(0);
  });

  test("roster table: search, sort, paginate, empty state, open a profile", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/students");
    await expect(page.getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });

    const nameHeader = page.getByRole("button", { name: /^name$/i });
    await nameHeader.click();
    await expect(nameHeader).toHaveAttribute("aria-sort", /ascending|descending/);

    await page.getByLabel(/search/i).fill("Ishita Choudhary");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText(/(?<!\d)1 total/)).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/search/i).fill("zzz-no-such-pupil-zzz");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText(/No students found/i)).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/search/i).fill("");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText(/\d+ total/)).toBeVisible({ timeout: 20000 });
    const next = page.getByRole("button", { name: /^next$/i });
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page.getByText(/Page 2 of/)).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/search/i).fill("Priya Patel");
    await page.getByRole("button", { name: /search/i }).click();
    await page.getByText("Priya Patel").first().click();
    await expect(page).toHaveURL(/\/students\/[a-z0-9]+/i);
    await expect(page.getByText(/report card/i).first()).toBeVisible({ timeout: 20000 });
  });

  test("counter payments: zero is rejected loudly, a real partial goes through", async ({ page }) => {
    await login(page, ACCOUNTS.sosAccountant, SOS_SLUG);
    await page.goto("/fees");
    await expect(page.locator("table").getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/filter by status/i).selectOption({ label: "Paid" });
    await page.getByRole("button", { name: /^filter$/i }).click();
    await expect(page.getByText("PENDING", { exact: true })).toHaveCount(0, { timeout: 20000 });
    await page.getByLabel(/filter by status/i).selectOption({ index: 0 });
    await page.getByRole("button", { name: /^filter$/i }).click();

    await expect(page.locator('select[aria-label="Unpaid invoice"]')).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/unpaid invoice/i).selectOption({ index: 1 });
    await page.getByLabel(/amount/i).fill("0");
    await page.getByRole("button", { name: /record payment/i }).click();
    await expect(page.getByText(/greater than zero|positive number/i)).toBeVisible({ timeout: 20000 });

    await page.getByLabel(/amount/i).fill("25");
    await page.getByRole("button", { name: /record payment/i }).click();
    await expect(page.getByText(/Recorded . invoice is now/i)).toBeVisible({ timeout: 20000 });
  });

  test("saved absences come back when the day is reopened", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/attendance/mark");
    // Grade 10 A: no other attendance test touches this section.
    await page.getByLabel(/section/i).selectOption({ label: "Grade 10 · A" });
    await expect(page.getByText("Priya Patel")).toBeVisible({ timeout: 20000 });

    await page.getByRole("button", { name: /mark all present/i }).click();
    const priyaRow = page.getByRole("group", { name: "Mark Priya Patel" });
    await priyaRow.getByRole("button", { name: /^absent$/i }).click();
    await page.getByRole("button", { name: /save attendance/i }).click();
    await expect(page.getByText(/saved attendance for/i)).toBeVisible({ timeout: 20000 });

    // Hard reload, pick the section again: the saved ABSENT must come back
    // as the active pill - not a silent PRESENT default.
    await page.reload();
    await page.getByLabel(/section/i).selectOption({ label: "Grade 10 · A" });
    await expect(page.getByText("Priya Patel")).toBeVisible({ timeout: 20000 });
    await expect(priyaRow.getByRole("button", { name: /^absent$/i })).toHaveAttribute("aria-pressed", "true", {
      timeout: 20000,
    });
    await expect(priyaRow.getByRole("button", { name: /^present$/i })).toHaveAttribute("aria-pressed", "false");

    // Changing the day re-hydrates against that day (unmarked -> defaults).
    await page.getByLabel(/date/i).fill("2026-09-01");
    await expect(priyaRow.getByRole("button", { name: /^present$/i })).toHaveAttribute("aria-pressed", "true", {
      timeout: 20000,
    });
  });

  test("a class-targeted notice reaches that class and only that class", async ({ page }) => {
    test.setTimeout(90000);
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/notices");
    const stamp = Date.now().toString(36);
    const title = `E2E Grade10 Notice ${stamp}`;
    await page.getByLabel(/title/i).fill(title);
    await page.getByLabel(/^message/i).fill("Scoped notice for Grade 10 only.");
    await page.getByLabel(/notice audience/i).selectOption("CLASS");
    await expect(page.locator('select[aria-label="Class"]')).toBeAttached({ timeout: 20000 });
    await page.locator('select[aria-label="Class"]').selectOption({ label: "Grade 10" });
    await page.getByRole("button", { name: /publish notice/i }).click();
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 20000 });

    // A Grade 10 pupil admitted on the spot can see it...
    await page.goto("/students/new");
    const pupilEmail = `e2e-g10-${stamp}@example.com`;
    const pupilName = `E2E Grade10 ${stamp}`;
    await page.getByLabel(/full name/i).fill(pupilName);
    await page.getByLabel("Email (student login)").fill(pupilEmail);
    await expect(page.locator('select[aria-label="Section"]')).toBeAttached({ timeout: 20000 });
    const sectionTexts = await page
      .locator('select[aria-label="Section"] option')
      .evaluateAll((opts) => opts.map((o) => o.textContent ?? ""));
    const g10 = sectionTexts.find((t) => t.includes("Grade 10"));
    expect(g10).toBeTruthy();
    await page.getByLabel(/section/i).selectOption({ label: g10 ?? "" });
    await page.getByRole("button", { name: /admit student/i }).click();
    await expect(page.getByRole("heading", { name: /admitted/i })).toBeVisible({ timeout: 20000 });
    const tempPassword = (await page.locator("code").first().textContent())?.trim() ?? "";

    await logout(page);
    await page.goto("/login");
    await page.getByLabel(/school slug/i).fill(SOS_SLUG);
    await page.getByLabel(/email/i).fill(pupilEmail);
    await page.getByLabel(/^password/i).fill(tempPassword);
    await page.getByRole("button", { name: /^login$/i }).click();
    await expect(page.getByText(/signed in as/i)).toBeVisible({ timeout: 20000 });
    await page.goto("/notices");
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 20000 });

    // ...and a Grade 9 pupil never does, while school-wide notices still land.
    await logout(page);
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/notices");
    await expect(page.getByText(title)).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByText("Parent-Teacher Meeting on Saturday").first()).toBeVisible({ timeout: 20000 });
  });

  test("marks entry refuses scores above the subject maximum", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/exams/results");
    const entryExam = page.getByLabel(/entry exam/i);
    await expect(entryExam).toBeVisible({ timeout: 20000 });
    await entryExam.selectOption({ index: 1 });
    const entrySubject = page.getByLabel(/entry subject/i);
    await expect(entrySubject).toBeVisible({ timeout: 20000 });
    await entrySubject.selectOption({ index: 1 });
    const entrySection = page.getByLabel(/entry section/i);
    await expect(entrySection).toBeAttached({ timeout: 20000 });
    await entrySection.selectOption({ index: 1 });
    // Boxes carry 0–max placeholders now (prefilled when marks were saved
    // before), so locate by the accessible name, not the placeholder.
    const firstBox = page.getByLabel(/marks for /i).first();
    await expect(firstBox).toBeVisible({ timeout: 20000 });
    // Regression: the roster nests names at user.name — a flat read once
    // shipped nameless boxes ("Marks for undefined") to production.
    expect(await firstBox.getAttribute("aria-label")).not.toContain("undefined");
    await firstBox.fill("9999");
    await page.getByRole("button", { name: /save marks/i }).click();
    await expect(page.getByText(/cannot exceed the maximum/i)).toBeVisible({ timeout: 20000 });
  });
});

test.describe("session, gates and edges", () => {
  test("signed-out gates, friendly 404, reload keeps the session, logout sticks", async ({ page }) => {
    await page.goto("/students");
    await expect(page.getByText(/Please sign in to view students/i)).toBeVisible({ timeout: 20000 });
    await page.getByRole("link", { name: /go to login/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/this-route-never-existed");
    await expect(page.getByText(/404/).first()).toBeVisible({ timeout: 20000 });

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/students");
    const admit = page.getByRole("link", { name: /admit student/i });
    await expect(admit).toBeVisible({ timeout: 20000 });
    await page.reload();
    await expect(admit).toBeVisible({ timeout: 20000 });

    await logout(page);
    await page.goBack();
    await page.waitForLoadState("load");
    await expect(page.getByRole("link", { name: /admit student/i })).toHaveCount(0, { timeout: 10000 });
  });

  test("phone-sized viewport: login and the shell stay usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.getByRole("link", { name: /open my board/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 20000 });
    // Phones start with the menu collapsed: content first, links one tap away.
    const menuButton = page.getByRole("button", { name: /open menu/i });
    await expect(menuButton).toBeVisible();
    const studentsLink = page.getByRole("link", { name: /^students$/i });
    await expect(studentsLink).toBeHidden();
    await menuButton.click();
    await expect(page.getByRole("button", { name: /close menu/i })).toBeVisible();
    await expect(studentsLink).toBeVisible();
    await studentsLink.click();
    await expect(page).toHaveURL(/\/students/);
    await expect(page.getByRole("heading", { name: /^students$/i })).toBeVisible({ timeout: 20000 });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("every sidebar destination opens clean for all six roles", async ({ page }) => {
    test.setTimeout(300000);
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(`console: ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      errors.push(`pageerror: ${err.message}`);
    });

    const walks: { email: string; slug: string | null; hrefs: string[] }[] = [
      {
        email: ACCOUNTS.sosAdmin,
        slug: SOS_SLUG,
        hrefs: [
          "/dashboard",
          "/students",
          "/teachers",
          "/sections",
          "/attendance/mark",
          "/fees",
          "/exams/results",
          "/timetable",
          "/homework",
          "/messages",
          "/crm",
          "/certificates",
          "/library",
          "/notices",
          "/profile",
        ],
      },
      {
        email: ACCOUNTS.sosTeacher,
        slug: SOS_SLUG,
        hrefs: ["/dashboard/teacher", "/attendance/mark", "/exams/results", "/homework", "/timetable", "/messages", "/profile"],
      },
      {
        email: ACCOUNTS.sosAccountant,
        slug: SOS_SLUG,
        hrefs: ["/dashboard/accountant", "/fees", "/fees/payments", "/crm", "/certificates", "/profile"],
      },
      {
        email: ACCOUNTS.sosStudent,
        slug: SOS_SLUG,
        hrefs: ["/dashboard/student", "/exams/results", "/homework", "/timetable", "/fees", "/notices", "/messages", "/library", "/profile"],
      },
      {
        email: ACCOUNTS.sosParent,
        slug: SOS_SLUG,
        hrefs: ["/dashboard/parent", "/exams/results", "/homework", "/fees", "/notices", "/messages", "/profile"],
      },
      { email: ACCOUNTS.owner, slug: null, hrefs: ["/dashboard/owner", "/profile"] },
    ];

    for (const walk of walks) {
      await login(page, walk.email, walk.slug);
      for (const href of walk.hrefs) {
        await page.goto(href);
        await expect(page.locator("h1").first()).toBeVisible({ timeout: 20000 });
      }
      await logout(page);
    }

    expect(errors).toEqual([]);
  });
});

test.describe("attendance reports", () => {
  test("admin reads the month, filters a section, an empty month, a custom range", async ({ page }) => {
    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/attendance/reports");
    await expect(page.getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Showing \d{4}/).first()).toBeVisible();

    await expect(page.locator('select[aria-label="Section"]')).toBeAttached({ timeout: 20000 });
    await page.getByLabel(/section/i).selectOption({ label: "Grade 10 · A" });
    await expect(page.getByText("Priya Patel").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Aditya Sharma")).toHaveCount(0);

    await page.getByLabel(/section/i).selectOption({ index: 0 });
    await page.getByLabel(/month/i).fill("2020-01");
    await page.getByRole("button", { name: /^show$/i }).click();
    await expect(page.getByText(/No attendance in this range/i)).toBeVisible({ timeout: 20000 });

    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    await page.getByLabel(/^from$/i).fill(start);
    await page.getByLabel(/^to$/i).fill(today);
    await page.getByRole("button", { name: /^show$/i }).click();
    await expect(page.getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });
  });

  test("pupil sees only their own row, no staff filter", async ({ page }) => {
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/attendance/reports");
    await expect(page.getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Priya Patel")).toHaveCount(0);
    await expect(page.getByLabel(/section/i)).toHaveCount(0);
  });
});

test.describe("homework submit scope", () => {
  test("submit box is pupil-only; teacher posts own subject successfully", async ({ page }) => {
    test.setTimeout(120000);
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    const [boardResp] = await Promise.all([
      page.waitForResponse(
        (r) => /\/homework(\?|$)/.test(r.url()) && r.request().method() === "GET",
        { timeout: 20000 },
      ),
      page.goto("/homework"),
    ]);
    expect(boardResp.ok()).toBeTruthy();
    await expect(page.getByText("Post homework (teacher)").first()).toBeVisible();
    // Teachers grade here - they never get the pupil submit box.
    await expect(page.getByText("Your answer (student)")).toHaveCount(0);

    // Arjun teaches Mathematics: qualified posting succeeds (Astronomy is
    // correctly refused server-side - teaching-relationship gate).
    await expect(page.locator('select[aria-label="Section ID"]')).toBeAttached({ timeout: 20000 });
    await page.getByLabel(/section/i).selectOption({ label: "Grade 9 A" });
    await expect(page.locator('select[aria-label="Subject"]')).toBeAttached({ timeout: 20000 });
    const subjects = await page
      .locator('select[aria-label="Subject"] option')
      .evaluateAll((opts) => opts.map((o) => o.textContent ?? ""));
    const math = subjects.find((t) => t.includes("Mathematics"));
    expect(math).toBeTruthy();
    await page.getByLabel(/subject/i).selectOption({ label: math ?? "" });
    const stamp = Date.now().toString(36);
    await page.getByLabel(/title/i).fill(`E2E Math ${stamp}`);
    await page.getByLabel(/description/i).fill("Teacher-qualified posting check.");
    // Due tomorrow: the pupil board takes the 100 earliest-due rows, so a
    // far-future date would bury the fresh card beyond older backlog.
    await page.getByLabel(/due date/i).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    await page.getByRole("button", { name: /post homework/i }).click();
    await expect(page.getByText(`E2E Math ${stamp}`).first()).toBeVisible({ timeout: 20000 });

    // The pupil (Grade 9 A) sees the submit box on the fresh card and submits.
    await logout(page);
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/homework");
    const card = page.locator("article", { hasText: `E2E Math ${stamp}` });
    await expect(card.getByText("Your answer (student)")).toBeVisible({ timeout: 20000 });
    await card.getByRole("textbox", { name: `Answer for E2E Math ${stamp}` }).fill("E2E answers here.");
    await card.getByRole("button", { name: /^submit$/i }).click();
    await expect(page.getByText(/Submitted — your teacher will grade it soon/i)).toBeVisible({ timeout: 20000 });
  });
});

test.describe("role depth: teacher, student, parent", () => {
  test("teacher sees only own section roster; others show the empty state", async ({ page }) => {
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/attendance/mark");
    await page.getByLabel(/section/i).selectOption({ label: "Grade 9 · B" });
    await expect(page.getByText("No students in this section")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: /save attendance/i })).toBeDisabled();
    await page.getByLabel(/section/i).selectOption({ label: "Grade 9 · A" });
    await expect(page.getByText("Aditya Sharma")).toBeVisible({ timeout: 20000 });
  });

  test("pupil resubmits: second submit also succeeds", async ({ page }) => {
    test.setTimeout(120000);
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/homework");
    await expect(page.locator('select[aria-label="Section ID"]')).toBeAttached({ timeout: 20000 });
    await page.getByLabel(/section/i).selectOption({ label: "Grade 9 A" });
    await expect(page.locator('select[aria-label="Subject"]')).toBeAttached({ timeout: 20000 });
    const subjects = await page
      .locator('select[aria-label="Subject"] option')
      .evaluateAll((opts) => opts.map((o) => o.textContent ?? ""));
    const math = subjects.find((t) => t.includes("Mathematics"));
    expect(math).toBeTruthy();
    await page.getByLabel(/subject/i).selectOption({ label: math ?? "" });
    const stamp = Date.now().toString(36);
    await page.getByLabel(/title/i).fill(`E2E Resubmit ${stamp}`);
    await page.getByLabel(/description/i).fill("Resubmit path check.");
    await page.getByLabel(/due date/i).fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    await page.getByRole("button", { name: /post homework/i }).click();
    await expect(page.getByText(`E2E Resubmit ${stamp}`).first()).toBeVisible({ timeout: 20000 });

    await logout(page);
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/homework");
    const card = page.locator("article", { hasText: `E2E Resubmit ${stamp}` });
    const box = card.getByRole("textbox", { name: `Answer for E2E Resubmit ${stamp}` });
    await expect(box).toBeVisible({ timeout: 20000 });
    await box.fill("First attempt answers.");
    await card.getByRole("button", { name: /^submit$/i }).click();
    await expect(page.getByText(/Submitted — your teacher will grade it soon/i).first()).toBeVisible({
      timeout: 20000,
    });
    await box.fill("Second attempt, improved answers.");
    await card.getByRole("button", { name: /^submit$/i }).click();
    await expect(page.getByText(/Submitted — your teacher will grade it soon/i).first()).toBeVisible({
      timeout: 20000,
    });
  });

  test("student fees show only their own invoices", async ({ page }) => {
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/fees");
    await expect(page.getByText("Aditya Sharma").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Priya Patel")).toHaveCount(0);
  });

  test("parent reads the child's homework board", async ({ page }) => {
    await login(page, ACCOUNTS.sosParent, SOS_SLUG);
    await page.goto("/homework");
    await expect(page.getByText("Geometry Problems").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel(/section/i)).toHaveCount(0);
  });

  test("parent messages the linked teacher", async ({ page }) => {
    test.setTimeout(90000);
    await login(page, ACCOUNTS.sosParent, SOS_SLUG);
    await page.goto("/messages");
    await expect(page.getByLabel(/recipient/i).locator("option", { hasText: /^Arjun Mehta/ })).toBeAttached({
      timeout: 20000,
    });
    const recipients = await page
      .getByLabel(/recipient/i)
      .locator("option")
      .evaluateAll((opts) => opts.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? "" })));
    const arjun = recipients.find((c) => c.text.startsWith("Arjun Mehta"));
    expect(arjun?.value).toBeTruthy();
    await page.getByLabel(/recipient/i).selectOption(arjun?.value ?? "");
    const stamp = Date.now().toString(36);
    await page.getByLabel(/first message/i).fill(`Parent probe ${stamp} - how is Aditya doing in maths?`);
    await page.getByRole("button", { name: /start conversation/i }).click();
    await expect(page.getByText(`Parent probe ${stamp}`).first()).toBeVisible({ timeout: 20000 });
  });

  test("pupil cannot open another pupil's profile", async ({ page, request }) => {
    const loginRes = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: ACCOUNTS.sosAdmin, password: PASSWORD, schoolSlug: SOS_SLUG },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginBody = (await loginRes.json()) as {
      data: { accessToken: string; user: { schoolId: string } };
    };
    const token = loginBody.data.accessToken;
    const schoolId = loginBody.data.user.schoolId;
    const listRes = await request.get(`${API}/api/v1/schools/${schoolId}/students?search=Priya&pageSize=3`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = (await listRes.json()) as { data: { students: { id: string }[] } };
    const priyaId = listBody.data.students[0]?.id ?? "";
    expect(priyaId).toBeTruthy();

    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto(`/students/${priyaId}`);
    await expect(page.getByText("Priya Patel")).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByText(/not your record|not found|failed to load|forbidden|denied/i)).toBeVisible({
      timeout: 20000,
    });
  });

  test("pupil is denied the admin dashboard", async ({ page }) => {
    await login(page, ACCOUNTS.sosStudent, SOS_SLUG);
    await page.goto("/dashboard");
    await expect(page.getByText(/not for your role|forbidden|permission/i)).toBeVisible({ timeout: 20000 });
  });

  test("counter refuses overpayment with the balance message", async ({ page }) => {
    await login(page, ACCOUNTS.sosAccountant, SOS_SLUG);
    await page.goto("/fees");
    await expect(page.locator('select[aria-label="Unpaid invoice"]')).toBeVisible({ timeout: 20000 });
    await page.getByLabel(/unpaid invoice/i).selectOption({ index: 1 });
    await page.getByLabel(/amount/i).fill("999999");
    await page.getByRole("button", { name: /record payment/i }).click();
    await expect(page.getByText(/exceeds the outstanding balance/i)).toBeVisible({ timeout: 20000 });
  });
});

test.describe("online pay flow", () => {
  test("parent pays online: TEST MODE shown, no amount sent, stubbed checkout succeeds, no card form", async ({
    page,
    request,
  }) => {
    // Hermetic: the pay-order API is answered with a canned order and the
    // Razorpay object is stubbed - no real gateway traffic, no card form
    // anywhere. What IS proven: our UI sends no amount, passes the
    // server order id + key into checkout, and handles success.
    const stamp = Date.now().toString(36);
    // Guarantee the child owes something: mint a fresh invoice via API
    // (Aditya's seeded invoices may all be settled by earlier runs).
    const adminLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: ACCOUNTS.sosAdmin, password: PASSWORD, schoolSlug: SOS_SLUG },
    });
    expect(adminLogin.ok()).toBeTruthy();
    const adminBody = (await adminLogin.json()) as {
      data: { accessToken: string; user: { schoolId: string } };
    };
    const adminToken = adminBody.data.accessToken;
    const schoolId = adminBody.data.user.schoolId;
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };
    const sectionsBody = (await (
      await request.get(`${API}/api/v1/schools/${schoolId}/sections`, { headers: adminHeaders })
    ).json()) as { data: { sections: { id: string; name: string; class: { id: string; name: string } }[] } };
    const section9A = sectionsBody.data.sections.find((s) => s.class.name === "Grade 9" && s.name === "A");
    expect(section9A?.id).toBeTruthy();
    const structRes = await request.post(`${API}/api/v1/schools/${schoolId}/fees/structures`, {
      headers: adminHeaders,
      data: {
        classId: section9A?.class.id ?? "",
        name: `E2E Online Struct ${stamp}`,
        amount: "1200.00",
        term: "Term 1",
        category: "TUITION",
      },
    });
    expect(structRes.ok()).toBeTruthy();
    const structBody = (await structRes.json()) as { data: { structure: { id: string } } };
    const pupilsBody = (await (
      await request.get(`${API}/api/v1/schools/${schoolId}/students?search=Aditya&pageSize=3`, {
        headers: adminHeaders,
      })
    ).json()) as { data: { students: { id: string }[] } };
    const adityaId = pupilsBody.data.students[0]?.id ?? "";
    expect(adityaId).toBeTruthy();
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const genRes = await request.post(`${API}/api/v1/schools/${schoolId}/fees/invoices/generate`, {
      headers: adminHeaders,
      data: { structureId: structBody.data.structure.id, studentIds: [adityaId], dueDate: future },
    });
    expect(genRes.status()).toBe(201);

    const bodies: string[] = [];
    await page.addInitScript(() => {
      (window as unknown as { __checkouts: { orderId: string; key: string }[] }).__checkouts = [];
      (window as unknown as { Razorpay?: unknown }).Razorpay = class {
        private options: Record<string, unknown>;
        constructor(options: Record<string, unknown>) {
          this.options = options;
        }
        open(): void {
          (window as unknown as { __checkouts: { orderId: string; key: string }[] }).__checkouts.push({
            orderId: this.options["order_id"] as string,
            key: this.options["key"] as string,
          });
          const handler = this.options["handler"] as (r: unknown) => void;
          handler({
            razorpay_payment_id: "pay_TEST_e2e",
            razorpay_order_id: this.options["order_id"],
            razorpay_signature: "sig_TEST_e2e",
          });
        }
        close(): void {}
        on(): void {}
      };
    });
    await page.route("**/fees/invoices/*/pay-order", async (route) => {
      bodies.push(route.request().postData() ?? "");
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { orderId: "order_TEST_e2e", keyId: "rzp_test_fake", amount: "15000.00", currency: "INR" },
          error: null,
          meta: null,
        }),
      });
    });

    await login(page, ACCOUNTS.sosParent, SOS_SLUG);
    await page.goto("/fees");
    await expect(page.getByText("TEST MODE").first()).toBeVisible({ timeout: 20000 });
    const payButton = page.getByRole("button", { name: /^pay$/i }).first();
    await expect(payButton).toBeVisible({ timeout: 20000 });
    await payButton.click();
    // The frontend sends ONLY the invoice id in the path - the body carries
    // no amount for anyone to tamper with.
    await expect(page.getByText(/Payment submitted \(pay_TEST_e2e\)/).first()).toBeVisible({ timeout: 20000 });
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[0]).toBe("{}");
    const seen = await page.evaluate(
      () => (window as unknown as { __checkouts: { orderId: string; key: string }[] }).__checkouts,
    );
    expect(seen).toEqual([{ orderId: "order_TEST_e2e", key: "rzp_test_fake" }]);
    // No custom card form exists anywhere on this page, by design (§13.8).
    await expect(page.getByText(/card number/i)).toHaveCount(0);
  });
});
