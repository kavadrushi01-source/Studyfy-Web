import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// The nav config once carried "href: null" placeholder entries rendered as
// dimmed text with a "Soon" pill. In a shipped product that reads as
// unfinished work and misstates what the role can do — so every entry now
// is a real page. This pins the absence gimmickry across one board per
// role-family (sidebars all render from the single ROLE_BOARDS config).
test.describe("no placeholder nav stubs anywhere", () => {
  for (const [key, email, slug] of [
    ["admin", "kavita.rao@schoolofscience.demo", "school-of-science"],
    ["teacher", "arjun.mehta@schoolofscience.demo", "school-of-science"],
    ["accountant", "vikram.solanki@schoolofscience.demo", "school-of-science"],
    ["student", "aditya.sharma@schoolofscience.demo", "school-of-science"],
    ["parent", "suresh.sharma@schoolofscience.demo", "school-of-science"],
  ] as const) {
    test(`${key} board shows no "Soon" stubs in the sidebar`, async ({ page }) => {
      await login(page, email, slug);
      await expect(page.getByText("Soon")).toHaveCount(0);
    });
  }

  test("owner console shows no 'Soon' stubs in the sidebar", async ({ page }) => {
    await login(page, "owner@studyfy.dev", null);
    await expect(page.getByText("Soon")).toHaveCount(0);
  });
});
