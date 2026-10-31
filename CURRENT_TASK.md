# Current Task — Session Handoff

> **Read this file FIRST, before anything else — even before `AGENT_START_HERE.md`.** This file is updated continuously *during* work. If the laptop shuts off or a fresh session starts with zero memory, reading this file must be enough to resume exactly where the last session stopped.

## STATUS: SESSION 12 COMPLETE — commit `02b4bd6` pushed: every demo student now has a PAYABLE Term 2 invoice (all parents can test payments); local DB reseeded; prod picks it up on next API deploy + demo-reset

### Session 12 — parent payment testing inventory (founder ask)

Founder wanted amounts to PAY as every parent, to exercise the payment flow. The seed gave only 1-in-8 students a payable invoice. `packages/demo-seed/src/index.ts` now also upserts a **"Term 2 Tuition"** fee structure per class and creates a **PENDING Term 2 invoice for EVERY student** (idempotent — safe under the nightly demo-reset). Local verified: **21 PENDING (₹2,611) + 2 OVERDUE + 12 PAID across 34 students**, 4 Term-2 structures. Ops lessons: (1) reseeding wipes the private owner password — restore with `npx tsx ../../prisma/seed.ts --reset-demo-passwords` requiring BOTH `$env:DEMO_PASSWORD='Demo@1234'` AND `$env:OWNER_PASSWORD='Local-Test-Owner-Password-123!'` (the e2e helper's owner password); (2) demo schools reseed nightly via cron (`POST /internal/jobs/demo-reset` with `X-Cron-Secret` — founder can call it manually on Render after the API redeploys to get the new invoices immediately). boards+accountant e2e 8/8 green after reseed.

### Session 11 final addendum — rail, logo placement, owner-chart fixes (founder screenshots)

Founder's shots showed: (1) logo tile CLIPPED at the top-left corner — the brand row (tile 38 + "Studyfy" ~70 + hidden menu btn) was ~170px centered in the 92px rail, overflowing both sides; (2) rail labels breaking mid-word ("Subscriptio ns & Billing"); (3) owner bar-chart value labels ("₹18,877.64") overlapping bars and clipping past the right edge. Fixes: rail 92→104px; collapsed rail hides the wordmark (tile sits alone, centered — the logo reads on its own); open rail = 200px so tile + wordmark + close btn fit; label wordBreak → overflowWrap anywhere (wraps at spaces now); MonthBars got padRight 54, compact labels ("₹18.9K" / "2.1K" via updated formatValue props + compact axis), so nothing overlaps or clips. Ops: stale `next start` process served a build whose CSS chunk 500'd — full `Get-Process node | Stop-Process` + restart of BOTH servers (API + web) with validation (fetch CSS, assert `104px`) before testing. Local 11/11; **prod 2/2** (logo tile fully inside rail bounds in both rail states; every owner-chart text bbox inside the svg viewBox). Commit `899025a`.

### Session 11 final — new logo mark across the whole site (founder ask)

The flat letter-"S" tiles looked plain. Now ONE shared mark (`components/ui/logo.tsx`, `LogoMark`): gradient squircle + white **GraduationCap** icon + layered 3D shadow (glow + inset top highlight + bottom inner shade), size-scalable. Swapped into **all 8 spots**: landing nav + footer, app shell (sidebar), login, signup, forgot/reset-password, enquiry. Deleted 7 duplicated `logoTile` inline consts (net -135 lines). Ops lesson: after rebuilds, `next start` can leave a STALE server on :3000 serving old cached HTML — the symptom is e2e failing on things that are obviously fixed (old "S" still in snapshot); fix = kill ALL :3000 listeners, verify port free, restart, and confirm the expected new markup (e.g. `lucide-graduation-cap`) in fetched HTML before testing. Verified: tc/lint/build clean, local public+nav-stubs **11/11 (17.9s)**, **prod live 1/1** (cap icon visible on landing nav, login, and in the app shell after login). Commits `1016809` + `54a3a35`.

### Session 11 addendum — scrolled navbar = floating rounded glass pill (founder ask)

When scrolled, the navbar now DETACHES from the top edge and becomes a rounded frosted-glass pill floating 10px down: `border-radius: 999px`, hairline border, layered 3D shadow (`0 24px 50px -22px` + `0 6px 16px -8px` + inset top highlight), blur(16px) saturate(170%). At the top of the page it stays fully transparent (same pill shape, invisible). Layout props (max-width 1120 / margin auto / radius) moved OUT of inline styles into `.sf-land-header` CSS so classes can control them — inline `borderRadius: 0` was blocking this. `top` transitions 0→10px smoothly. Verified tc/lint/build clean, local public+nav-stubs 10 passed + 1 flake-recovered, **prod 1/1** (measured: radius 999px, top 10px, layered shadow, frosted bg after scroll). Commit `db8907e`.

### Session 11 summary — whole-site responsiveness pass (founder's narrow-desktop screenshot)

The founder's ~1300px-wide window showed the owner dashboard cramped: rail labels ellipsized ("PLATFORM O…", "Subscrip…", "Users Ma…"). Root cause: `shell.tsx` used `whiteSpace: nowrap + textOverflow: ellipsis` on the role badge label and every rail item label; and `.sf-grid-kpi` only collapsed below 1024px (dashboards sat 4-across squeezed at 1024-1280px):

1. **`components/ui/shell.tsx`**: role badge label now wraps (whiteSpace normal, lineHeight 1.3 — "PLATFORM OWNER" fits on two lines); rail item labels use `-webkit-box` line-clamp 2 + word-break (real wrapped text, no "…"; accessible names + e2e `getByRole("link", {name})` assertions unchanged — the full text is still there).
2. **`globals.css`**: KPI grid collapses to 2×2 below **1280px** (was 1024 — the squeeze band is gone); `.sf-grid-2-1`/`.sf-grid-1-1` stack below 1280; `.sf-main` gets relaxed padding below 1200px (22px 20px 40px). Wider than 1280 stays 4-across (verified both).
3. Verified: tc/lint/build clean; full e2e 102 passed + 2 retry-recovered flakes (audit export, marks-entry — pass solo; 104/104 effectively). **Ops note:** the local API died twice more (laptop sleep); restart pattern that works: set `$env:DATABASE_URL/'…studyfy_e2e'`, `$env:PORT='4000'` + all FIVE limiter overrides =500 in the same PowerShell call, `Start-Process node dist/server.js` from apps/api (env inherits). `EADDRINUSE` on :4000 means the previous background start actually survived — probe /health before starting another.
4. **Prod verified 2/2** (live, both viewports): at 1100x800 the badge computes `white-space: normal`, rail item labels `webkit-line-clamp: 2`, KPI grid 2 columns; at 1500x900 KPI grid 4 columns. School-user login uses the school slug; public sample credentials are listed on the login page.

### Session 10 summary — navbar like gyanmirai, premium charts everywhere, full functional test, perf pass

1. **Navbar (gyanmirai-style, light-theme adapted)** (`globals.css` `.sf-land-header*`, `public-nav.tsx`): header is now TRANSPARENT at the top — no white band, it floats over the hero (gyanmirai's transparent nav, color-matched to our light theme); after 8px scroll it gains frosted glass + hairline + shadow (`.sf-land-header-scrolled`). Nav links bumped to 14px #334155. "Get Started" CTA is now a gradient pill (`gradients.accent`) with a blue glow shadow + inset highlight (own `ctaPill` style, NOT the shared `secondaryBtn` — that would change buttons app-wide; `secondaryBtn` import dropped from public-nav).
2. **Premium chart polish across the whole site** — one shared CSS layer (`.sf-chart*` in globals.css) wired into every hand-rolled SVG: `.sf-chart` soft drop-shadow elevation; `.sf-chart-line` glow + `.sf-chart-draw` stroke-dashoffset draw-in animation; `.sf-chart-bar` scaleY rise-in (transform-box: fill-box) with stagger delays; `.sf-chart-seg` donut segment fade/rotate-in with 3px white gaps (dasharray -3/+3) and stagger; `.sf-chart-dot` dot shadows; `.sf-chart-divbar` for the analytics div-bars (gradient fill + glow + stagger). Touched: `app/dashboard/page.tsx` (GrowthChart), `app/dashboard/accountant/page.tsx` (TrendChart + StatusDonut), `app/dashboard/owner/page.tsx` (MonthBars gradient fill + PlansDonut), `app/analytics/page.tsx` (attendance line segments + fee bars). Global reduced-motion block collapses all durations → final state instantly. ARIA labels/values untouched (e2e-safe).
3. **Perf pass**: hero particle canvas now pauses via IntersectionObserver when the hero scrolls offscreen (was only tab-hidden); showcase PNGs already lazy (priority on first only, sizes="800px", next/image webp). **Landing "loads too much" root cause to tell the founder: the Render FREE-tier API sleeps after ~15 min idle — first login then waits ~30-60s cold start. keep-warm.yml pings every 10 min but GitHub Actions cron drifts; the real fix is upgrading the Render plan (founder's call, costs money).**
4. **Full functional test**: `npx playwright test` = **104/104 passed, ZERO flakes** (cleanest run yet).
5. **Prod verify lessons**: school-user login requires the SCHOOL SLUG (`school-of-science`); email+password alone fails for non-owner roles. Production sample-school logins are read-only and time-limited.
6. Verified prod 3/3: header bg transparent at top → glass after scroll (computed), CTA has linear-gradient + glow shadow, `svg.sf-chart` + `.sf-chart-line.sf-chart-draw` attached on /dashboard, owner rail clean.

### Session 9 summary — product showcase (founder's gyanmirai screenshots, v6 = keeper)

Six iterations on the "inside the app" landing display. v4 (big chrome-bar window, `4205637`) got "more small, remove the fake bar, every page scrolls one by one"; v5 (820px clean window + deeper captures + de-boxed nav, `ad3ed4c`) got "it just shows one page — I want EVERY ROLE's page, shifting one by one". Root cause of "one page": all six captures were School-Admin pages (they look identical) AND hover-pause could stall the cycle forever when the cursor rested on the display. v6 is the keeper (commit `e25218d`):

1. **`scripts/capture-showcase.mjs`**: logs in SEPARATELY per role (fresh context each; login → wait "Signed in as" → optional "Open my board" click → settle 1200ms → fullPage screenshot; viewport 1280x1200 @1.5x) and captures 7 REAL role pages: admin dashboard + students (kavita.rao), teacher board `/dashboard/teacher` + `/attendance/mark` (arjun.mehta), accountant `/fees` (vikram.solanki), parent board `/dashboard/parent` (suresh.sharma — guardians get Demo@1234 too), owner console `/dashboard/owner` (owner@studyfy.dev). Re-seed first: `$env:DATABASE_URL='mysql://root:9328581846@127.0.0.1:3306/studyfy_e2e'; npx prisma migrate reset --force --skip-generate --schema=..\..\prisma\schema.prisma` then `$env:NODE_ENV='development'; $env:DATABASE_URL='…studyfy_e2e'; npx tsx ..\..\prisma\seed.ts` (from apps/api).
2. **`components/ui/landing/showcase.tsx`** (v6): SHOTS = the 7 role pages; NO hover-pause anymore (only press/swipe + tab-hidden + focus pause) so the cycle never stalls; each active page auto-scrolls top→bottom (`@keyframes sf-show-pan`, 9s, `forwards`, restarted per activation) then the next ROLE's page cross-fades in (0.7s). public.spec asserts 7 slides + pan motion.
3. **Navbar de-boxed** (v5, kept): no gray pill container — freestanding round chips, active = brand-blue tint `rgba(37,99,235,.09)`.
4. **CRITICAL ops lesson (caused 2 e2e failures):** restarting the API with only DATABASE_URL+PORT drops the rate-limiter overrides — signup/enquiry/forgot-password e2e tests then hit 429s and fail ("element not found" on confirmations). ALWAYS restart the API with all five: `LOGIN_ACCOUNT_LIMIT_MAX`, `REGISTER_RATE_LIMIT_MAX`, `ENQUIRY_RATE_LIMIT_MAX`, `EXPORT_RATE_LIMIT_MAX`, `TICKET_CREATE_LIMIT_MAX` = 500 (plus DATABASE_URL studyfy_e2e@3306 + PORT=4000). Also: `Start-Process cmd '/c','set','X=Y&&',…` corrupts env (trailing spaces) — set `$env:` in the same PowerShell call and Start-Process node directly; killing all node processes kills the `npx next start` child too — restart web after.
5. Verified: typecheck/lint/build clean; full e2e 103 passed + 1 retry-recovered flake (104/104 effectively); **prod 3/3** — 7 slides, pan moves, active index advanced twice in 19s (one by one, no stall), nav pill transparent + brand chip, owner rail clean. Prod login selectors: `/^login$/i` button; `input[type="password"]` (eye-toggle aria-label strict-clashes getByLabel).

## Session 8 record (previous session)

**Session 8** — commit `adb07de` pushed (glass navbar + icon rail); prod live-verified 3/3.

**Prior state (session 7:** `22bdbe6` — no "Soon" stubs, animated no-pricing landing, login polish + keep-warm workflow; prod 5/5). Session 8 was a further founder screenshot pass on top of that.

### Session 8 summary — screenshot pass #3 ("remove demo card, glass navbar, gyanmirai-style rail")

1. **Landing demo-credentials card removed** (`app/page.tsx`) — the "Try the live demo" section (`#demo`, slug/roles tiles) is gone per the founder's screenshot; the hero CTA "Open the live demo" and the footer remain the paths to try it. Spec asserts the heading is at count 0 and "Demo credentials ship with the repository" copy is gone.
2. **Premium glass navbar** — new `components/ui/landing/public-nav.tsx`: sticky header with a floating center pill (`sf-land-pill`), scroll-spy active section (scroll listener + section probe, bottom-of-page = last section), `.sf-land-header-scrolled` shadow after 8px scroll, "About" added to the links (the old nav pointed at the deleted `#demo`; about/contact replace it). Reduced-motion guarded.
3. **Reveal-on-scroll** — new `components/ui/landing/reveal-on-scroll.tsx` (null-rendering client component): observes `[data-reveal]` sections and adds `.sf-reveal-in`; the hidden/translated state (`.sf-reveal`) is only added at mount, so a no-JS load shows everything (no content lost); in-viewport elements show immediately (no blink). Updated `app/page.tsx` sections with `data-reveal`.
4. **App shell rebuilt as an icon rail** (founder's reference screenshots, app.gyanmirai.in style) — `components/ui/shell.tsx`: light 92px rail, logo tile, role badge as icon circle + tiny uppercase label, each nav entry an icon column + REAL-TEXT tiny label (accessible names and every `getByRole("link", {name})` e2e assertion keep working), active item gets `#EFF6FF` tint + left accent bar, logout rail item at the bottom, `role-boards.ts` gained `NAV_ICONS` (label→icon; a renamed label falls back to no icon, never a crash). On phones (≤900px) the rail items are credentials unchanged: `.sf-menu-btn` toggle still collapses (`sf-side-collapsed` hides nav+logout via the pre-existing !important rules), `.sf-side-rail .sf-side-nav` becomes a horizontal scroll strip when open. Global `scroll-behavior: smooth` (reduced-motion guarded) gives the app the animated-scroll feel the founder pointed at.
5. **e2e**: `public.spec.ts` updated (demo-card absent, hero CTA + "Get Started" present). Temp prod spec/config deleted after use; screenshots at `apps/test-artifacts/prod-landing-8.png`, `prod-rail-owner.png`, `prod-rail-teacher.png`.

### Session 8 verification record

- typecheck `tsc --noEmit` clean, lint clean, build clean (`$env:NEXT_PUBLIC_API_URL='http://localhost:4000'` baked).
- Full web e2e: **104 tests — 103 passed + 1 retry-recovered flake** (`support.spec` owner-console, environmental; same class as the historical pwa/SW and worker flake).
- Prod (after `bd6921c..adb07de` deploy): 3/3 — glass pill nav + no demo card + canvas; owner icon rail (8 items) + zero "Soon"; teacher rail → "Notices" navigates to the real Notice Board.
- Teacher-prod lesson (not a bug): `/notices`, `/homework`, `/fees` etc. render standalone (no Shell) — the rail exists on dashboards and module pages that mount Shell; do not assert rail-logout from URLs that never had a sidebar.

## Session 7 summary (previous, still true)

1. **All seven "Soon" nav stubs removed** (`components/ui/role-boards.ts` + `components/ui/shell.tsx`) — teacher "My Classes", accountant "Collection Reports"/"Student Fee Ledger"/"Reports & Analytics", student "Attendance", parent "My Children"+"Attendance", owner "Platform Analytics" now link their real pages. `NavItem.href` is `string`-only; the "Soon" pill branch is deleted from the shell. Nav is link-or-nothing.
2. **Landing rebuilt** (`app/page.tsx`, `components/ui/landing/hero-visual.tsx`, `app/globals.css`) — pricing section and `PLANS` import gone (public.spec asserts ₹-strings and "Simple, Transparent Pricing" absent), hero "One calm dashboard for your whole school", fact pills, same nine pinned feature titles, tenant-isolation section (`#tenants`: SOS teal vs RK maroon), 3-step how-it-works. `hero-visual.tsx` is a zero-dependency client component: canvas particle field (dpr ≤2, ResizeObserver reseed, pauses on `document.hidden`) + rAF-throttled mouse-tilt 3D card stack; disabled when reduced-motion or `innerWidth <= 560`; `aria-hidden` decor, no invented KPI numbers.
3. **Login system** (`app/login/page.tsx`) — show/hide password toggle, remember-me, `/health` pre-warm on mount. Fresh sign-in resolves to "Signed in as X (role)" + single **"Open my board"** link via `boardPathForRole(me.role)` — label is load-bearing for e2e.
4. **Signed-in handling is a hint, not a bounce** — mount effect reads `studyfy-session` and renders an inline "Open my board — or sign in below with a different account" notice above the INTACT form (auto-redirect broke in-context account switching — BUGSFIX 92).
5. **`.github/workflows/keep-warm.yml`** — cron `*/10` `GET https://studyfy-api.onrender.com/health` so Render stops cold-booting.
6. **e2e**: suite grown to **104** (`nav-stubs.spec.ts` added; `public.spec.ts` rewritten).

### Session 7 verification record

- Web typecheck/lint/build clean; **web e2e 103 passed + 1 flaky (pwa SW retry) = 104/104**.
- API: **no changes** (green in session 6's runs; Windows worker-crash flake documented in #88–90).
- BUGSFIX added **#91** (stubs+landing+login+keep-warm) and **#92** (no router.replace off /login; stale-server EADDRINUSE trap: verify port owner pid + probe a new-build marker before trusting e2e failures).

The founder's session-7 ask, verbatim for context: kill the faint "SOON" stubs, improve the login system, redo the landing page (no pricing — this is a portfolio demo; add good free 3D animation), fix perceived loading lag, then test, deploy, report all done.

### Local e2e harness recipe (reproducible)

DB: `mysql://root:9328581846@127.0.0.1:3306/studyfy_e2e` (created, migrated, seeded `npx tsx prisma/seed.ts` with `NODE_ENV=development`).

```powershell
# API (from apps/api, after npm run build there)
$env:DATABASE_URL='mysql://root:9328581846@127.0.0.1:3306/studyfy_e2e'; $env:PORT='4000'
$env:LOGIN_ACCOUNT_LIMIT_MAX='500'; $env:REGISTER_RATE_LIMIT_MAX='500'; $env:ENQUIRY_RATE_LIMIT_MAX='500'
$env:EXPORT_RATE_LIMIT_MAX='500'; $env:TICKET_CREATE_LIMIT_MAX='500'
node dist/server.js                     # ~10s to boot; health at /health

# Web (from apps/web; NEXT_PUBLIC_API_URL is baked at BUILD time)
$env:NEXT_PUBLIC_API_URL='http://localhost:4000'
npm run build; Start-Process with `npx next start -p 3000` (verify port-3000 owner BEFORE trusting e2e results)

# Playwright (from apps/web)
$env:E2E_API_URL='http://localhost:4000'; npx playwright test
```

Limiter overrides exist because back-to-back full passes from one IP drain the shared in-memory buckets (public signup/enquiry, support tickets) — flushing requires an API restart. PowerShell gotchas that burned time: `$pid` is read-only (must loop `$k | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` or use a different variable name like `$procId`); `rm -rf` is bash-only (use `Remove-Item`); PS 5.1 has no ternary (`? :`). Brevo rejects this laptop's IP for ticket email (`525 Unauthorized IP address`) — calls complete, mail fails, non-fatal.

## Where things stand overall

1. **Layer 2/3/4 (sessions 1–5)** — deployment audit GO, 477 route-combos clean, teacher-scope leak fixed (BUGSFIX 88). Report: `docs/testing/LAYER4_REPORT.md`.
2. **Session 6** (`84ed8b9`) — banner removed, login pre-warm, CRM/Library scrollIntoView, Settings rebuilt, role navs trimmed, P2028 staff-invite tx fix (BUGSFIX 89–90), live-verified 5/5 on prod.
3. **Session 7** (`22bdbe6`) — stubs gone (BUGSFIX 91–92), landing rebuilt without pricing + 3D hero, login polish + no-bounce hint, keep-warm workflow, suite at 104.
4. **Session 8 (this one)** (`adb07de`) — landing demo-card removed, glass pill navbar + scroll-spy, reveal-on-scroll, app shell reborn as the light icon rail, smooth scroll global.

## Remaining (finish this list)

1. ~~Commits + pushes~~ — `22bdbe6`, `bd6921c`, `adb07de` all on main; Vercel deployed each; keep-warm workflow live.
2. ~~Live-verify prods~~ — session 7: 5/5; session 8: 3/3 (glass nav + demo card gone; owner icon rail + zero "Soon"; teacher Notices navigation). Temp files deleted each time; screenshots in `apps/test-artifacts/` (gitignored).
3. Founder actions (manual): set `PLATFORM_GSTIN`/`PLATFORM_STATE` on Render; **delete the leaked Render API key `rnd_P5qHlcgctDVKV7KeVX8ywu67YD0D` in the Render dashboard**; rotate Aiven + Cloudinary creds (pasted in chat during earlier sessions).

## Test-suite reality recap

`npm run test --workspace=@studyfy/api` needs `TEST_DATABASE_URL` pointing at local MySQL80 `studyfy_test` (migrated 45/45). The Windows-native Prisma worker crash (exit `3221226505`) can kill a random file's worker on some full-parallel runs; retry solo or rerun — assertions never fail, Linux CI never showed it. Never commit the DB password.

## Cleanup state

All temporary credential files deleted (`secret.md` deleted + gitignored in session 5). Local e2e DB `studyfy_e2e` and pids/logs (`$env:TEMP\opencode\*.log`, pid files) are local-only. Temp prod verify files from session 6 were deleted; if session 7's prod check re-creates them, delete them after. No secrets in this doc.
