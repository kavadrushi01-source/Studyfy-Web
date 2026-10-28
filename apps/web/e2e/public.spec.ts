import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// PART 1 (no login) + login screen itself — including the envelope-crash
// regression: a failed login must show the server message, never
// "Cannot read properties of null".
test.describe("public site + login", () => {
  test("landing has spec copy, animated hero, and no fabricated stats, badges, or pricing", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1").first()).toBeVisible();
    for (const name of ["Student Management", "Parent Communication", "Reports & Analytics"]) {
      await expect(page.getByRole("heading", { name })).toBeVisible();
    }
    // Pricing was intentionally removed from the landing (tiers are shown
    // in-app after sign-in); the demo-credentials card was removed too —
    // the hero CTA links straight into the login flow instead.
    await expect(page.getByText(/₹5,999\/month|₹1,999\/month|₹2,999\/month|₹4,999\/month/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Simple, Transparent Pricing/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Try the live demo" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /open the live demo/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get Started" })).toBeVisible();
    await expect(page.getByText("Better Schools. Brighter Futures.")).toBeVisible();
    await expect(page.getByText(/500\+ Happy Schools|50K\+ Students|99% Uptime/)).toHaveCount(0);
    await expect(page.getByText(/App Store|Google Play/)).toHaveCount(0);
    await expect(page.locator("canvas")).toBeVisible();
    // Inside-the-app display: real captures, auto-advancing slideshow.
    await expect(page.getByRole("heading", { name: /See It From the Inside/i })).toBeVisible();
    await expect(page.locator(".sf-show-slide")).toHaveCount(6);
    await expect(page.locator(".sf-show-slide-active img")).toBeVisible();
    await page.screenshot({ path: "e2e/shots/landing.png", fullPage: true });
  });

  test("wrong password shows the server message instead of crashing", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/school slug/i).fill("school-of-science");
    await page.getByLabel(/email/i).fill("kavita.rao@schoolofscience.demo");
    await page.getByLabel(/^password/i).fill("definitely-wrong");
    await page.getByRole("button", { name: /^login$/i }).click();
    await expect(page.getByText("Invalid email or password.")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Cannot read properties")).toHaveCount(0);
  });

  test("signup wizard completes and shows slug + school ID", async ({ page }) => {
    const stamp = Date.now().toString(36);
    await page.goto("/signup");
    await page.getByLabel(/school name/i).fill(`E2E School ${stamp}`);
    await page.getByRole("button", { name: /next/i }).click();
    await page.getByLabel(/admin name/i).fill("E2E Admin");
    await page.getByLabel(/admin email/i).fill(`e2e-admin-${stamp}@example.com`);
    await page.getByLabel(/admin password/i).fill("password-123");
    await page.getByRole("button", { name: /create school/i }).click();
    await expect(page.getByText("Your school is ready!")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/e2e-school-/)).toBeVisible();
    await page.screenshot({ path: "e2e/shots/signup-done.png" });
  });

  test("enquiry + forgot-password happy paths", async ({ page }) => {
    await page.goto("/enquiry");
    await page.getByLabel(/school.*slug/i).fill("school-of-science");
    await page.getByLabel(/your name/i).fill("E2E Prospect");
    await page.getByLabel(/^phone/i).fill("+91-9999999999");
    await page.getByLabel(/^message/i).fill("E2E admission enquiry for Grade 6 next session.");
    await page.getByRole("button", { name: /send enquiry/i }).click();
    await expect(page.getByText(/received/i)).toBeVisible({ timeout: 15000 });

    await page.goto("/forgot-password");
    await page.getByLabel(/school slug/i).fill("school-of-science");
    await page.getByLabel(/email/i).fill("kavita.rao@schoolofscience.demo");
    await page.getByRole("button", { name: /send reset link/i }).click();
    await expect(page.getByText(/reset link has been sent|check your inbox/i)).toBeVisible({ timeout: 15000 });
  });

  test("admin login lands with board link", async ({ page }) => {
    await login(page, "kavita.rao@schoolofscience.demo", "school-of-science");
    await expect(page.getByText("Kavita Rao")).toBeVisible();
    await page.screenshot({ path: "e2e/shots/login-done.png" });
  });
});
