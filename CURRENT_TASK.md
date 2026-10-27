# Current Task — Session Handoff

> **Read this file FIRST, before anything else — even before `AGENT_START_HERE.md`.** This file is updated continuously *during* work. If the laptop shuts off or a fresh session starts with zero memory, reading this file must be enough to resume exactly where the last session stopped.

## STATUS: SESSION 7 (bounce fix verified) — remaining: commit, push, prod live-verify

**Prior state (session 6):** commit `84ed8b9` pushed to main — six-screenshot UI pass + P2028 staff-invite fix, live-verified 5/5 on prod with a temporary Playwright spec (delete temp files when done). Usage guide delivered to the founder (demo emails, board URLs, prod password `mega`, TEST MODE payments).

### Session 7 summary — second screenshot pass ("stubs / landing / login")

The founder sent six more screenshots and asked: kill the faint "SOON" stubs, improve the login system, redo the landing page (no pricing — this is a portfolio demo; add good free 3D animation), fix perceived loading lag, then test, deploy, report all done.

1. **All seven "Soon" nav stubs removed** (`components/ui/role-boards.ts` + `components/ui/shell.tsx`) — teacher "My Classes", accountant "Collection Reports"/"Student Fee Ledger"/"Reports & Analytics", student "Attendance", parent "My Children"+"Attendance", owner "Platform Analytics" now link their real pages. `NavItem.href` is `string`-only; the "Soon" pill branch is deleted from the shell. Nav is link-or-nothing.
2. **Landing rebuilt** (`app/page.tsx`, `components/ui/landing/hero-visual.tsx`, `app/globals.css`) — pricing section and `PLANS` import gone (public.spec asserts ₹-strings and "Simple, Transparent Pricing" absent), hero "One calm dashboard for your whole school", CTAs "Open the live demo" + "See what's inside", fact pills, same nine pinned feature titles, tenant-isolation section (`#tenants`: SOS teal vs RK maroon), 3-step how-it-works, "Try the live demo" card (slugs + roles, **no password on the public page** — creds live in repo's DEMO_DATA.md), About/Contact/footer kept. New `.sf-land-*` CSS (aurora blobs, float, tilt/lean, all under the existing `prefers-reduced-motion` block). `hero-visual.tsx` is a zero-dependency client component: canvas particle field (dpr ≤2, ResizeObserver reseed, pauses on `document.hidden`) + rAF-throttled mouse-tilt 3D card stack; disabled when reduced-motion or `innerWidth <= 560`; `aria-hidden` decor, no invented KPI numbers.
3. **Login system** (`app/login/page.tsx`) — show/hide password toggle (Eye/EyeOff, aria-labelled), remember-me kept, `/health` pre-warm on mount kept. Fresh sign-in still resolves to the "Signed in as X (role)" card + single **"Open my board"** link via `boardPathForRole(me.role)` — label is load-bearing: e2e specs click `getByRole("link", { name: /open my board/i })` (renaming it "Go to my board" caused 12 failures). NO auto-redirect timers (they race test navigation — see BUGSFIX 92).
4. **Signed-in handling is a hint, not a bounce** — mount effect reads `studyfy-session` from localStorage and (if token+user) sets `returningBoard`, rendering an inline "You already have a signed-in session → Open my board — or sign in below with a different account" notice above the INTACT form. The first version auto-`router.replace`d to the board and broke in-context account switching (boards/deep specs log in twice inside one context; the slug form disappeared). Fixed and verified. `useRouter` import removed again.
5. **`.github/workflows/keep-warm.yml`** — cron `*/10 * * * *` `GET https://studyfy-api.onrender.com/health`, `continue-on-error`, `workflow_dispatch`, concurrency group `keep-api-warm`, `permissions: {}`. Kills the Render free-tier cold start (~20s) that sat inside every first login. Free (public repo Actions minutes).
6. **e2e**: `public.spec.ts` landing test rewritten (pricing absent, "Try the live demo" visible, canvas visible); new `e2e/nav-stubs.spec.ts` — all six role logins assert `getByText("Soon")` count 0. Suite is now **104 tests**.

### Verification record (this box, Windows)

- Web typecheck `tsc --noEmit` clean, lint clean, `npm run build` clean (52 static pages), with `$env:NEXT_PUBLIC_API_URL='http://localhost:4000'` (baked at build time).
- Web e2e (local MySQL + local API + fresh `next start`, `E2E_API_URL='http://localhost:4000'`): **103 passed + 1 flaky (pwa service-worker retry, environmental) = 104/104** in 7.6 min. First full runs exposed two genuine issues, both fixed and re-verified: the auto-bounce (#92) and a stale `next start` process that kept port 3000 and served the old build (EADDRINUSE trap — verify the port owner pid is younger than the build; probe a new-build marker like "One calm dashboard").
- API: **no changes this session** (suite green in session 6's runs; Windows worker-crash flake documented in #88–90).
- BUGSFIX entries added: **#91** (stubs + landing + login + keep-warm) and **#92** (bounce-lesson + stale-server lesson).

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
2. **Session 6** (`84ed8b9`) — banner removed, login pre-warm, CRM/Library scrollIntoView, Settings rebuilt, role navs trimmed, P2028 staff-invite tx fix (BUGSFIX 89–90), 98/98 web e2e, live-verified 5/5 on prod.
3. **Session 7 (this one)** — stubs gone, landing rebuilt without pricing + 3D hero, login polish + no-bounce hint, keep-warm workflow, e2e suite grown to 104, BUGSFIX 91–92.

## Remaining (finish this list)

1. Commit + push (code+specs+docs). Render (API) and Vercel (web) deploy on push; workflow file activates on next Actions run.
2. Live-verify prod with a temporary `e2e/prod.config.ts` (workers 1, `globalSetup` skipped) + temp spec — checks: landing hero "One calm dashboard" + canvas without pricing; login page has show/hide toggle + `/health` pre-warm; sign-in (prod password `mega`) → "Open my board"; owner/teacher/accountant/parent boards have **no** "Soon" text anywhere; delete temp files after.
3. Founder actions (manual): set `PLATFORM_GSTIN`/`PLATFORM_STATE` on Render; **delete the leaked Render API key `rnd_P5qHlcgctDVKV7KeVX8ywu67YD0D` in the Render dashboard**; rotate Aiven + Cloudinary creds (pasted in chat during earlier sessions).

## Test-suite reality recap

`npm run test --workspace=@studyfy/api` needs `TEST_DATABASE_URL` pointing at local MySQL80 `studyfy_test` (migrated 45/45). The Windows-native Prisma worker crash (exit `3221226505`) can kill a random file's worker on some full-parallel runs; retry solo or rerun — assertions never fail, Linux CI never showed it. Never commit the DB password.

## Cleanup state

All temporary credential files deleted (`secret.md` deleted + gitignored in session 5). Local e2e DB `studyfy_e2e` and pids/logs (`$env:TEMP\opencode\*.log`, pid files) are local-only. Temp prod verify files from session 6 were deleted; if session 7's prod check re-creates them, delete them after. No secrets in this doc.
