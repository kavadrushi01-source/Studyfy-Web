// Dev-only utility: captures the "inside the app" showcase screenshots for
// the landing page. Not picked up by Playwright (no .spec suffix). Run with:
//   $env:NEXT_PUBLIC... (nothing needed) — web on :3000, API on :4000
//   node scripts/capture-showcase.mjs
// Writes PNGs (1280x800 @2x) to public/showcase/. All data shown is the
// fabricated demo seed (see DEMO_DATA.md), safe to publish.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const FRONT = process.env.SHOWCASE_FRONT ?? "http://localhost:3000";
const OUT = new URL("../public/showcase/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const SLUG = "school-of-science";
const EMAIL = "kavita.rao@schoolofscience.demo";
const PASSWORD = "Demo@1234";

const SHOTS = [
  { path: "/dashboard", slug: true, out: "admin-dashboard", caption: "School Admin · Overview" },
  { path: "/students", slug: true, out: "students", caption: "School Admin · Student records" },
  { path: "/fees", slug: true, out: "fees", caption: "School Admin · Fees & payments" },
  { path: "/attendance/mark", slug: true, out: "attendance", caption: "School Admin · Attendance" },
  { path: "/timetable", slug: true, out: "timetable", caption: "School Admin · Timetable" },
  { path: "/library", slug: true, out: "library", caption: "School Admin · Library" },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const res = await fetch(`${FRONT}/login`);
      if (res.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error("web server not reachable on :3000");
    await new Promise((r) => setTimeout(r, 500));
  }

  // One authenticated context, reused across every capture.
  await page.goto(`${FRONT}/login`, { waitUntil: "networkidle" });
  await page.getByLabel(/school slug/i).fill(SLUG);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/^password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.getByText(/Signed in as/i).waitFor({ timeout: 30000 });
  await page.getByRole("link", { name: /open my board/i }).click();
  await page.waitForURL("**/dashboard");
  await page.waitForLoadState("networkidle");

  for (const shot of SHOTS) {
    await page.goto(`${FRONT}${shot.path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200); // skeleton -> data settle
    const file = new URL(`${shot.out}.png`, OUT).pathname.replace(/^\/(\w:)/, "$1");
    await page.screenshot({ path: file });
    console.log("captured", shot.out);
  }
} finally {
  await browser.close();
}
