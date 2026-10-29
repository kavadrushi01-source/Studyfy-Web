# Current Task — Session Handoff

> **Read this file FIRST, before anything else — even before `AGENT_START_HERE.md`.** This file is updated continuously *during* work. If the laptop shuts off or a fresh session starts with zero memory, reading this file must be enough to resume exactly where the last session stopped.

## STATUS: SESSION 9 COMPLETE — commit `ad3ed4c` pushed (showcase v5: smaller clean window + deeper scrolls; nav rounder); prod live-verified 3/3; nothing left but org chores

### Session 9 summary — product showcase (founder's gyanmirai screenshots, v5 = keeper)

The founder iterated five times on the "inside the app" landing display; v1 tilted rail (`0e37c10`) and v2 big fade slideshow (`c7ea012`) rejected; v3 tablet+filmstrip (`b33f3da`) rejected; v4 big chrome-bar window with vertical pan (`4205637`) got "more small, remove the fake browser bar (clean), every page must scroll one by one, fix boxy navbar". v5 is the keeper (commit `ad3ed4c`):

1. **`scripts/capture-showcase.mjs`** (dev-only, eslint-ignored): captures FULL-PAGE PNGs, viewport 1280x1200 @1.5x (1920px wide; every page ≥1800px tall so the pan has real depth — at viewport 900 the short pages were 1350 tall ≈ 16:10 with ~50px of pan, invisible). Run AFTER a DB re-seed — `$env:DATABASE_URL='mysql://root:9328581846@127.0.0.1:3306/studyfy_e2e'; npx prisma migrate reset --force --skip-generate --schema=..\..\prisma\schema.prisma` then `$env:NODE_ENV='development'; $env:DATABASE_URL='…studyfy_e2e'; npx tsx ..\..\prisma\seed.ts` (from apps/api; NODE_ENV=development required or resolveDemoPassword throws). Schema default URL is studyfy_dev@3307; always override.
2. **`components/ui/landing/showcase.tsx` → `ShowcaseDisplay`** (v5): ONE SMALLER clean window — `.sf-show-stage` max-width 820px (padding 26px), NO fake browser chrome (founder: "clean"), just the rounded 18px frame. Screenshots stack + cross-fade (0.7s) every 9000ms; active slide's image auto-scrolls via `@keyframes sf-show-pan` (`object-position: 50% 0% → 100%`, 9s, `forwards`), bound to `.sf-show-slide-active img` so it restarts per activation — each page scrolls through, one by one. Pause on hover/focus/hidden; swipe 40px; reduced-motion static.
3. **Navbar de-boxed** (`globals.css` `.sf-land-pill*`): removed the gray pill container (founder: "boxy, colors weird") — links are now freestanding round chips; active = soft brand-blue chip `rgba(37,99,235,.09)` + `#1d4ed8` text; hover = `rgba(15,23,42,.05)`. Header keeps frosted-glass on scroll. public.spec/prod spec assert the pill's computed background is transparent and the active chip is the brand tint.
4. Verified: typecheck/lint/build clean; full e2e green (flaky human/owner tests pass solo — human 21/21, human+owner 27/27; suite total 104 via `--list`); **prod 3/3** — pan moves + pages advance + chrome bar gone, nav pill transparent with brand-tinted active chip, owner rail clean. **Server-restart lesson:** `Start-Process cmd '/c','set','X=Y&&','set','PORT=4000&&','node',…` corrupts env values (trailing spaces) — set `$env:` in the same PowerShell call and Start-Process node directly (inherits env). Killing all node processes also kills the `npx next start` child — restart web after.

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
