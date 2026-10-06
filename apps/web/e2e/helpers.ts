import { expect, type Page } from "@playwright/test";

export const SOS_SLUG = "school-of-science";
export const RK_SLUG = "ramakrishna-school";
export const PASSWORD = "Demo@1234";

export const ACCOUNTS = {
  sosAdmin: "kavita.rao@schoolofscience.demo",
  sosTeacher: "arjun.mehta@schoolofscience.demo",
  sosAccountant: "vikram.solanki@schoolofscience.demo",
  sosStudent: "aditya.sharma@schoolofscience.demo",
  sosParent: "suresh.sharma@schoolofscience.demo",
  sosLibrarian: "lata.nair@schoolofscience.demo",
  sosTransport: "ravi.nair@schoolofscience.demo",
  rkAdmin: "s.venkataraman@ramakrishnaschool.demo",
  rkTeacher: "anjali.kulkarni@ramakrishnaschool.demo",
  rkStudent: "krishna.murthy@ramakrishnaschool.demo",
  owner: "owner@studyfy.dev",
};

export async function login(page: Page, email: string, slug: string | null): Promise<void> {
  await page.goto("/login");
  if (slug) {
    await page.getByLabel(/school slug/i).fill(slug);
  }
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^login$/i }).click();
  await expect(page.getByText(/signed in as/i)).toBeVisible({ timeout: 20000 });
}

export async function logout(page: Page): Promise<void> {
  // Shell-less pages (/messages, /students, …) carry no logout button, so
  // always sign out from /profile, which every role can open.
  await page.goto("/profile");
  await page.getByRole("button", { name: /log out/i }).click({ timeout: 20000 });
  await expect(page).toHaveURL(/\/login/);
}
