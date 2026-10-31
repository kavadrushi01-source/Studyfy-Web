import { expect, type Page } from "@playwright/test";

export const SOS_SLUG = "school-of-science";
export const RK_SLUG = "ramakrishna-school";
export const PASSWORD = "Demo@1234";
export const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? "Local-Test-Owner-Password-123!";

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
  await page.getByLabel(/^password/i).fill(email === ACCOUNTS.owner ? OWNER_PASSWORD : PASSWORD);
  await page.getByRole("button", { name: /^login$/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:[/?#]|$)/, { timeout: 20000 });
}

export async function logout(page: Page): Promise<void> {
  const logoutButton = page.getByRole("button", { name: /log out/i });
  if (!(await logoutButton.count())) {
    // Shell-less pages (/messages, /students, …) have no logout control.
    await page.goto("/profile");
  }
  await page.getByRole("button", { name: /log out/i }).click({ timeout: 20000 });
  await expect(page).toHaveURL("/", { timeout: 10000 });
}
