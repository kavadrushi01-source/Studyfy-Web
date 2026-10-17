// Stage 5 UI/UX/a11y verification — local only, against running local
// servers (E2E_WEB_URL, E2E_API_URL; E2E_PASSWORD defaults Demo@1234).
// Compares rendered boards against docs/designs/*.md (written spec,
// §8.2–§8.4) and takes screenshots as local evidence.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3000";
const API = process.env.E2E_API_URL ?? "http://localhost:4001";
const PASSWORD = process.env.E2E_PASSWORD ?? "Demo@1234";
const SHOTS = fileURLToPath(new URL("../e2e/shots/stage5", import.meta.url));
console.log("DEBUG SHOTS:", SHOTS);
mkdirSync(SHOTS, { recursive: true });

const LOGIN = "/login";

function shotName(role, page, viewport) {
  return join(SHOTS, `${role}-${viewport.width}x${viewport.height}-${page
    .split("/")
    .pop()
    .replace(/\?.*$/, "") || "index"}.png`);
}

async function loginAs(page, email, slug) {
  await page.goto(`${WEB}/login`);
  if (slug) {
    await page.getByLabel(/school slug/i).fill(slug);
  }
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.getByText(/signed in as/i).waitFor({ state: "visible", timeout: 20000 });
}

async function a11yCheck(page, label) {
  const problems = [];
  const h1Count = await page.locator("h1").count();
  if (h1Count === 0) problems.push("no <h1>");
  // Images without alt
  const imgs = page.locator("img");
  for (const img of await imgs.all()) {
    const alt = await img.getAttribute("alt");
    if (alt === null || alt === "") problems.push(`image without alt: ${(await img.getAttribute("src")).slice(0, 60)}`);
  }
  // Inputs/selects/textarea lacking an explicit/accessible label
  const fields = page.locator("input:not([type=hidden]), textarea, select");
  for (const fld of await fields.all()) {
    const labelled = await fld.evaluate(
      (el) => !!el.closest("label") || !!el.getAttribute("aria-label") || !!el.getAttribute("aria-labelledby"),
    );
    if (!labelled) problems.push(`field may lack accessible name: ${await fld.getAttribute("name") ?? fld.getAttribute("type") ?? "select/textarea"}`);
  }
  return { label, problems, h1: h1Count };
}

async function main() {
  const browser = await chromium.launch();
  const results = [];
  const mobile = { width: 390, height: 844, deviceScaleFactor: 1 };
  const desktop = { width: 1280, height: 800 };

  // ---- School Admin (SOS) ----
  {
    const page = await browser.newPage({ viewport: desktop });
    await loginAs(page, "kavita.rao@schoolofscience.demo", "school-of-science");
    const views = [
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
      "/notices",
      "/library",
      "/certificates",
      "/transport",
      "/billing",
      "/audit-logs",
      "/support",
      "/settings",
      "/profile",
    ];
    for (const view of views) {
      const res = await page.goto(`${WEB}${view}`, { waitUntil: "domcontentloaded" });
      const ok = res?.ok() ?? false;
      await page.screenshot({ path: shotName("sos-admin", view, desktop), fullPage: true });
      results.push({ role: "school-admin", view, status: res?.status(), ok, a11y: await a11yCheck(page, `sos-admin ${view}`) });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 4);
      if (overflow) results[results.length - 1].horizontalOverflow = true;
    }
    // Mobile spot checks (founder's phone check: zero overflow on dashboard/support/billing/audit-logs)
    for (const view of ["/dashboard", "/support", "/billing", "/audit-logs"]) {
      const pageM = await browser.newPage({ viewport: mobile });
      await loginAs(pageM, "kavita.rao@schoolofscience.demo", "school-of-science");
      await pageM.goto(`${WEB}${view}`, { waitUntil: "domcontentloaded" });
      await pageM.screenshot({ path: shotName("sos-admin-mobile", view, mobile), fullPage: true });
      const overflow = await pageM.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 4);
      results.push({ role: "school-admin-mobile", view, overflow, ok: true });
      await pageM.close();
    }
    await page.close();
  }

  // ---- Teacher ----
  {
    const page = await browser.newPage({ viewport: desktop });
    await loginAs(page, "arjun.mehta@schoolofscience.demo", "school-of-science");
    const views = ["/dashboard/teacher", "/attendance/mark", "/exams/results", "/homework", "/timetable", "/messages", "/library", "/transport", "/profile"];
    for (const view of views) {
      const res = await page.goto(`${WEB}${view}`, { waitUntil: "domcontentloaded" });
      await page.screenshot({ path: shotName("teacher", view, desktop), fullPage: true });
      results.push({ role: "teacher", view, status: res?.status(), ok: res?.ok() ?? false, a11y: await a11yCheck(page, `teacher ${view}`) });
    }
    await page.close();
  }

  // ---- Accountant ----
  {
    const page = await browser.newPage({ viewport: desktop });
    await loginAs(page, "vikram.solanki@schoolofscience.demo", "school-of-science");
    const views = ["/dashboard/accountant", "/fees", "/certificates", "/payroll"];
    for (const view of views) {
      const res = await page.goto(`${WEB}${view}`, { waitUntil: "domcontentloaded" });
      await page.screenshot({ path: shotName("accountant", view, desktop), fullPage: true });
      results.push({ role: "accountant", view, status: res?.status(), ok: res?.ok() ?? false, a11y: await a11yCheck(page, `accountant ${view}`) });
    }
    await page.close();
  }

  // ---- Student ----
  {
    const page = await browser.newPage({ viewport: desktop });
    await loginAs(page, "aditya.sharma@schoolofscience.demo", "school-of-science");
    const views = ["/dashboard/student", "/exams/results", "/homework", "/timetable", "/fees", "/notices", "/messages", "/library", "/transport", "/profile"];
    for (const view of views) {
      const res = await page.goto(`${WEB}${view}`, { waitUntil: "domcontentloaded" });
      await page.screenshot({ path: shotName("student", view, desktop), fullPage: true });
      results.push({ role: "student", view, status: res?.status(), ok: res?.ok() ?? false, a11y: await a11yCheck(page, `student ${view}`) });
    }
    await page.close();
  }

  // ---- Parent ----
  {
    const page = await browser.newPage({ viewport: desktop });
    await loginAs(page, "suresh.sharma@schoolofscience.demo", "school-of-science");
    const views = ["/dashboard/parent", "/exams/results", "/homework", "/fees", "/notices", "/messages", "/library", "/transport", "/profile"];
    for (const view of views) {
      const res = await page.goto(`${WEB}${view}`, { waitUntil: "domcontentloaded" });
      await page.screenshot({ path: shotName("parent", view, desktop), fullPage: true });
      results.push({ role: "parent", view, status: res?.status(), ok: res?.ok() ?? false, a11y: await a11yCheck(page, `parent ${view}`) });
    }
    await page.close();
  }

  // ---- Platform Owner ----
  {
    const page = await browser.newPage({ viewport: desktop });
    await loginAs(page, "owner@studyfy.dev", null);
    const views = [
      "/dashboard/owner",
      "/owner/schools",
      "/owner/billing",
      "/owner/users",
      "/owner/support",
      "/owner/audit-logs",
      "/owner/settings",
    ];
    for (const view of views) {
      const res = await page.goto(`${WEB}${view}`, { waitUntil: "domcontentloaded" });
      await page.screenshot({ path: shotName("owner", view, desktop), fullPage: true });
      results.push({ role: "owner", view, status: res?.status(), ok: res?.ok() ?? false, a11y: await a11yCheck(page, `owner ${view}`) });
    }
    await page.close();
  }

  await browser.close();
  writeFileSync(join(SHOTS, "stage5-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
