import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ACCOUNTS, SOS_SLUG, login } from "./helpers";

// Student CSV import end to end (§7 Phase 0, §16.1): admin uploads a file
// with 2 good rows + 1 bad row on the SOS demo school — the report names
// every row, and the imported pupils land on the real roster. Unique emails
// per run so repeats never collide with earlier runs' rows.
test.describe("student CSV import", () => {
  test("uploads a mixed file: per-row report + roster carries the imported", async ({ page }) => {
    const stamp = Date.now().toString(36);
    const csvPath = join(tmpdir(), `students-import-${stamp}.csv`);
    writeFileSync(
      csvPath,
      [
        "StudentName,StudentEmail,Section,AdmissionNo,GuardianName,GuardianEmail,GuardianRelationship",
        `Import Pupil One,import-one-${stamp}@example.com,Grade 9-A,,Import Guardian One,import-guardian-one-${stamp}@example.com,Father`,
        `Import Pupil Two,import-two-${stamp}@example.com,Grade 9-A,,Import Guardian Two,import-guardian-two-${stamp}@example.com,Mother`,
        `Import Pupil Bad,import-bad-${stamp}@example.com,Nope-Z,,Import Guardian Bad,import-guardian-bad-${stamp}@example.com,Father`,
      ].join("\n"),
    );

    await login(page, ACCOUNTS.sosAdmin, SOS_SLUG);
    await page.goto("/students");
    await page.getByRole("link", { name: /import csv/i }).click();
    await expect(page).toHaveURL(/\/students\/import/);

    await page.locator('input[type="file"]').setInputFiles(csvPath);
    await page.getByRole("button", { name: /upload and import/i }).click();

    await expect(page.getByText("2 imported · 1 refused · 3 rows").first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/was not found in this school/).first()).toBeVisible();
    await expect(page.getByText("Import Pupil One").first()).toBeVisible();
    await expect(page.getByText("Import Pupil Two").first()).toBeVisible();

    // The imported pupils are real roster rows, not report-only text.
    await page.goto("/students");
    await page.getByLabel(/search students/i).fill(`import-one-${stamp}`);
    await page.getByRole("button", { name: /^search$/i }).click();
    await expect(page.getByText(`import-one-${stamp}@example.com`).first()).toBeVisible({ timeout: 20000 });
  });
});
