// Dev-only utility: captures the "inside the app" showcase screenshots for
// the landing page. Not picked up by Playwright (no .spec suffix). Run with:
//   web on :3000, API on :4000
//   node scripts/capture-showcase.mjs
// Writes FULL-PAGE PNGs (1920px wide @1.5x) to public/showcase/ — tall
// captures (viewport height 1200 so even short pages have scroll depth
// for the landing display's auto-scroll). Each PNG is a DIFFERENT ROLE's
// page (admin, teacher ×2, accountant, parent, platform owner) so the
// display cycles through the whole product, one role at a time.
// All data shown is the fabricated demo seed (see DEMO_DATA.md), safe to publish.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const FRONT = process.env.SHOWCASE_FRONT ?? "http://localhost:3000";
const OUT = new URL("../public/showcase/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const PASSWORD = "Demo@1234";

// One entry per authenticated session; `board: true` captures the page the
// "Open my board" interstitial lands on; shots with path:null capture the
// page we are already on (the board itself).
const SESSIONS = [
  {
    email: "kavita.rao@schoolofscience.demo",
    slug: "school-of-science",
    shots: [
      { path: "/dashboard", out: "admin-dashboard" },
      { path: "/students", out: "students" },
    ],
  },
  {
    email: "arjun.mehta@schoolofscience.demo",
    slug: "school-of-science",
    board: true,
    shots: [
      { path: null, out: "teacher-board" },
      { path: "/attendance/mark", out: "teacher-attendance" },
    ],
  },
  {
    email: "vikram.solanki@schoolofscience.demo",
    slug: "school-of-science",
    shots: [{ path: "/fees", out: "accountant-fees" }],
  },
  {
    email: "suresh.sharma@schoolofscience.demo",
    slug: "school-of-science",
    board: true,
    shots: [{ path: null, out: "parent-board" }],
  },
  {
    email: "owner@studyfy.dev",
    slug: null,
    shots: [{ path: null, out: "owner-console" }],
  },
];

const browser = await chromium.launch();
try {
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const res = await fetch(`${FRONT}/login`);
      if (res.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error("web server not reachable on :3000");
    await new Promise((r) => setTimeout(r, 500));
  }

  for (const session of SESSIONS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 1.5 });
    await page.goto(`${FRONT}/login`, { waitUntil: "networkidle" });
    if (session.slug) {
      await page.getByLabel(/school slug/i).fill(session.slug);
    }
    await page.getByLabel(/email/i).fill(session.email);
    await page.getByLabel(/^password/i).fill(PASSWORD);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.getByText(/Signed in as/i).waitFor({ timeout: 30000 });
    if (session.board) {
      await page.getByRole("link", { name: /open my board/i }).click();
      await page.waitForURL("**/dashboard**");
      await page.waitForLoadState("networkidle");
    }
    for (const shot of session.shots) {
      if (shot.path) {
        await page.goto(`${FRONT}${shot.path}`, { waitUntil: "networkidle" });
      }
      await page.waitForTimeout(1200); // skeleton -> data settle
      const file = new URL(`${shot.out}.png`, OUT).pathname.replace(/^\/(\w:)/, "$1");
      await page.screenshot({ path: file, fullPage: true });
      console.log("captured", shot.out, "as", session.email);
    }
    await page.context().close();
  }
} finally {
  await browser.close();
}