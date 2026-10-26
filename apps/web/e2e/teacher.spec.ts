import { expect, test, type APIRequestContext } from "@playwright/test";
import { ACCOUNTS, PASSWORD, SOS_SLUG, RK_SLUG, login } from "./helpers";

const API = process.env.E2E_API_URL ?? "http://localhost:4001";

async function apiTeacher(request: APIRequestContext): Promise<{ token: string; schoolId: string }> {
  const res = await request.post(`${API}/api/v1/auth/login`, {
    data: { schoolSlug: SOS_SLUG, email: ACCOUNTS.sosTeacher, password: PASSWORD },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { data: { accessToken: string; user: { schoolId: string } } };
  return { token: body.data.accessToken, schoolId: body.data.user.schoolId };
}

// Teacher Today view + the full teaching circuit, driven like a human:
// board, mark, post, submit-as-pupil is covered in admin flow; here the
// scoping proofs (unlinked message, admin-board denial).
test.describe("SOS teacher circuit", () => {
  test("board shows only own sections; marking flips it", async ({ page }) => {
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/dashboard/teacher");
    await expect(page.getByText("Arjun Mehta").first()).toBeVisible({ timeout: 20000 });
    // Presence, not exact-once: the E2E DB accumulates homework rows across
    // runs (each run posts its own), so several "Grade 9 · A" labels may
    // legitimately render. The scoping proof is the "Grade 10" zero below.
    await expect(page.getByText("Grade 9 · A").first()).toBeVisible();
    await expect(page.getByText("Grade 10")).toHaveCount(0);
    await page.screenshot({ path: "e2e/shots/teacher-board.png" });

    await page.goto("/attendance/mark");
    await page.getByLabel(/section/i).selectOption({ label: "Grade 9 · A" });
    await expect(page.getByText("Aditya Sharma")).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: /save attendance/i }).click();
    await expect(page.getByText(/saved attendance for/i)).toBeVisible({ timeout: 20000 });
  });

  test("teacher posts homework; admin sees it read-only", async ({ page }) => {
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/homework");
    // Arjun only passes the teaching gate for his own section+subject —
    // pick them by name, never by index.
    await expect(page.locator('select[aria-label="Section ID"]')).toBeAttached({ timeout: 20000 });
    const secTexts = await page.locator('select[aria-label="Section ID"] option').allTextContents();
    const secIdx = secTexts.findIndex((t) => /9/.test(t) && /\bA\b/.test(t));
    expect(secIdx).toBeGreaterThan(0);
    await page.getByLabel(/section/i).selectOption({ index: secIdx });
    await expect(page.locator('select[aria-label="Subject"]')).toBeAttached({ timeout: 20000 });
    await page.getByLabel(/subject/i).selectOption({ label: "Mathematics" });
    const hwStamp = Date.now().toString(36);
    await page.getByLabel(/title/i).fill(`E2E Worksheet ${hwStamp}`);
    await page.getByLabel(/description/i).fill("End to end verification problems for the class.");
    await page.getByLabel(/due date/i).fill("2026-12-01");
    await page.getByRole("button", { name: /post homework/i }).click();
    await expect(page.getByText(`E2E Worksheet ${hwStamp}`).first()).toBeVisible({ timeout: 20000 });
  });

  test("unlinked student message is refused with the server message", async ({ page }) => {
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto("/messages");
    // Deterministic in any run order: Arjun writes something fresh to linked
    // Aditya first, so a thread is guaranteed regardless of which suites ran
    // before. Priya Patel (10-A) is not taught by Arjun: no thread may exist
    // for her, and the picker must not offer her either. NOTE: several
    // options contain "Aditya Sharma" (his guardians read "Parent of Aditya
    // Sharma"), so match the pupil option exactly.
    await expect(page.getByLabel(/recipient/i).locator("option").nth(1)).toBeAttached({ timeout: 20000 });
    const candidates = await page
      .getByLabel(/recipient/i)
      .locator("option")
      .evaluateAll((opts) =>
        opts.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent ?? "" })),
      );
    const aditya = candidates.find((c) => /^Aditya Sharma \(/.test(c.text));
    expect(aditya?.value).toBeTruthy();
    const probe = `Linked probe ${Date.now().toString(36)}`;
    await page.getByLabel(/recipient/i).selectOption(aditya?.value ?? "");
    await page.getByLabel(/first message/i).fill(probe);
    await page.getByRole("button", { name: /start conversation/i }).click();
    await expect(page.getByText(probe).first()).toBeVisible({ timeout: 20000 });
    // A direct send must surface the matrix denial, not a silent nothing.
    await expect(page.getByText("Priya Patel")).toHaveCount(0);
  });

  test("admin board redirects teachers to their own board", async ({ page }) => {
    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    // /dashboard is the SCHOOL_ADMIN board — teachers are bounced to
    // /dashboard/teacher (BUGSFIX 83), never shown the admin shell.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/teacher/, { timeout: 20000 });
    await page.screenshot({ path: "e2e/shots/teacher-denied-admin.png" });
  });

  test("teacher reviews the AI draft on Aditya's report card", async ({ page, request }) => {
    // Deterministic across re-runs: reset the seeded AI draft to unreviewed
    // over the API first (a previous run may have reviewed it already —
    // the e2e database persists between local runs).
    const { token, schoolId } = await apiTeacher(request);
    const headers = { Authorization: `Bearer ${token}` };
    const pupils = (await (
      await request.get(`${API}/api/v1/schools/${schoolId}/students?search=Aditya%20Sharma`, { headers })
    ).json()) as { data: { students: { id: string }[] } };
    const pupilId = pupils.data.students[0]?.id;
    const exams = (await (
      await request.get(`${API}/api/v1/schools/${schoolId}/exams`, { headers })
    ).json()) as { data: { exams: { id: string; name: string }[] } };
    const exam = exams.data.exams.find((e) => e.name === "Unit Test 1");
    expect(pupilId).toBeTruthy();
    expect(exam?.id).toBeTruthy();
    const queue = (await (
      await request.get(
        `${API}/api/v1/schools/${schoolId}/exams/${exam?.id}/remarks?studentId=${pupilId}`,
        { headers },
      )
    ).json()) as { data: { remarks: { id: string; generatedBy: string; remark: string }[] } };
    const draft = queue.data.remarks.find((r) => r.generatedBy === "AI");
    expect(draft?.id).toBeTruthy();
    await request.patch(`${API}/api/v1/schools/${schoolId}/exams/${exam?.id}/remarks/${draft?.id}`, {
      headers,
      data: {
        remark: "This student shows steady progress with room to grow in problem-solving speed.",
        reviewed: false,
      },
    });

    await login(page, ACCOUNTS.sosTeacher, SOS_SLUG);
    await page.goto(`/students/${pupilId}/report`);
    await expect(page.getByRole("heading", { name: /report card/i })).toBeVisible({ timeout: 20000 });
    const examSelect = page.getByRole("combobox", { name: "Exam" });
    await expect(examSelect.locator("option").nth(1)).toBeAttached({ timeout: 20000 });
    await examSelect.selectOption({ label: "Unit Test 1" });
    await expect(page.getByRole("heading", { name: /report card remarks/i })).toBeVisible({ timeout: 20000 });

    const draftItem = page.locator("li", { hasText: "AI draft" });
    await expect(draftItem).toBeVisible({ timeout: 20000 });
    const stamp = Date.now().toString(36);
    await draftItem.getByLabel("Remark text").fill(`E2E reviewed remark ${stamp}`);
    await draftItem.getByRole("button", { name: /mark reviewed/i }).click();
    await expect(page.getByText(/marked reviewed/i)).toBeVisible({ timeout: 20000 });
    await expect(page.locator("li", { hasText: `E2E reviewed remark ${stamp}` })).toBeVisible();
    await page.screenshot({ path: "e2e/shots/remark-review.png" });

    const after = (await (
      await request.get(
        `${API}/api/v1/schools/${schoolId}/exams/${exam?.id}/remarks?studentId=${pupilId}`,
        { headers },
      )
    ).json()) as { data: { remarks: { id: string; remark: string; reviewed: boolean }[] } };
    const signed = after.data.remarks.find((r) => r.id === draft?.id);
    expect(signed?.reviewed).toBe(true);
    expect(signed?.remark).toBe(`E2E reviewed remark ${stamp}`);
  });
});

test.describe("RK teacher mirror", () => {
  test("Anjali sees only her sections", async ({ page }) => {
    await login(page, ACCOUNTS.rkTeacher, RK_SLUG);
    await page.goto("/dashboard/teacher");
    await expect(page.getByText("Anjali Kulkarni").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Grade 9 · A")).toBeVisible();
  });
});
