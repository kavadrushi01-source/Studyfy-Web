# Current Task — Session Handoff

> **Read this file FIRST, before anything else — even before
> `AGENT_START_HERE.md`.** This is the one file that must be updated
> continuously *during* work, not just when a task finishes. Its entire
> purpose: if the laptop shuts off, VS Code closes, or the next session runs
> on a completely different free OpenCode model with zero memory of this
> conversation, that next session can read this file and resume exactly
> where the last one stopped — no guessing, no re-deriving context from
> scratch.

**Status:** IN PROGRESS (work complete — commit/push is the last step)
**Phase / Module:** Premium UI redesign (whole web app) + e2e hardening
**Last updated:** 2026-09-26

## What's done in this task so far
- Premium UI redesign across EVERY route (founder: "premium level — every route, every button, every page"): new shared design system in `apps/web/app/globals.css` (token/class layer) + `apps/web/lib/theme.ts` primitives (colors, shadows, radii, motion); `shell.tsx` (navy sidebar + blue `#2563EB` kept — spec-pinned) and `data-table.tsx` restyled; all 31 pages across the 4 agent groups (public/auth, admin, teacher, accountant, student/parent) rebuilt inline-style-only, lucide-react icons, no new deps, TS strict. Spec-pinned copy/labels/aria/hrefs untouched — the 29-test e2e suite is the regression gate. `sf-rise`/`sf-card-hover` removed from interactive containers. `next build` green.
- E2e reliability — root causes found and fixed (each verified):
  1. **Cold-start stalls**: first tests of every spec timed out (45s) after fresh build/boot while Windows/Defender re-read chunks and 6 Chromium workers booted → NEW `apps/web/e2e/global-setup.ts` warms 20 web routes + login + 6 hot API GETs (never touches forgot/reset/register — spares rate buckets); `workers` capped 6→4 (`E2E_WORKERS` overrides).
  2. **Register limiter exhaustion**: `registerLimiter` (10/hour/IP) burned by run 3 of every session → `REGISTER_RATE_LIMIT_MAX` local-only env knob (default 10 unchanged; documented in RATE_LIMITING.md). Same for `enquiryLimiter` (5/15min) → `ENQUIRY_RATE_LIMIT_MAX` — the suite posts 1 enquiry/run, exhausted by run 6.
  3. **Session-restore bug** (`auth-context.tsx`): `.catch(() => localStorage.removeItem(...))` destroyed the session when an in-flight `/auth/me` aborted on navigation → now clears only on 401/403; network errors/5xx/aborts keep the session.
  4. **Notice publish blocked on SMTP**: Brevo connect hung up to 20s under variance → nodemailer bounded (connection/greeting 3s, socket 5s) in `mailer.ts`.
  5. **admin:75 oversight race**: three spec files share the Arjun↔Aditya thread and race for the last-message preview → probe parked on Ishita Choudhary's exclusive thread; recipient option-picker waits (`toBeAttached` + anchored `/^Ishita Choudhary/` — "Parent of Ishita Choudhary" is a strict-mode trap); `test.setTimeout(60000)` for the 3-role mega-flow; homework selects waited before pick (raw-ID fallback race).
  6. **deep:24 false empty state (PRODUCT BUG)**: homework grade section rendered "Nothing waiting for a grade right now." while still loading (`items=[] → every()=true`), so tests (and users!) caught a lying empty state → gated on `loading` with `SkeletonBlocks`; the test now settles on `nothing.or(gradeBtns.first())` before branching.
  7. **Machine stalls**: trace proved one run's admin dashboard request took **38,357ms** server-side while the box sat at 62% CPU with OneDrive churn (capacity re-proven fine: 40 concurrent dashboard probes @ max 206ms) → `retries: 1` in playwright.config (a genuine regression still fails both attempts; stall-riders show as "flaky").
- Gates ALL green after final edits: web typecheck 0, web lint 0, api typecheck 0, api lint 0, root lint 0, API build 0, **API tests 181/181 (51 files)**, **e2e 29/29 repeatedly (1.4–1.7m; stall runs now absorbed by retry)**.
- Visual check done (Playwright screenshots in gitignored `e2e/shots/`): landing, login, dashboard, students, fees, timetable, notices — gradient headline, KPI icon tiles, accent sidebar, clean table with `Page 1 of 5 · 44 total` intact.

## What's left in this task
- Commit + push the whole change set (36 modified + new files), then report.

## Exact next action
- `git add -A && git commit` (message covering UI overhaul + e2e hardening), `git push`, then hand the report to the founder. After that this task is DONE — Chunk 5 (public site/deploy/Phase-1 close-out, spec §7 Phase 1 #10) remains the next founder-gated task.

## Notes / decisions made mid-task
- Local API start command NOW needs 3 override knobs (defaults unchanged for CI/prod — never set them there): `cmd /c "set PORT=4001&& set DATABASE_URL=mysql://root@127.0.0.1:3307/studyfy_e2e&& set FRONTEND_ORIGIN=http://localhost:3001&& set JWT_ACCESS_SECRET=dev-access-secret-change-me-please-001&& set LOGIN_RATE_LIMIT_MAX=200&& set REGISTER_RATE_LIMIT_MAX=200&& set ENQUIRY_RATE_LIMIT_MAX=200&& node dist/server.js"`. Web: `npx next start --port 3001` in apps/web (built with `NEXT_PUBLIC_API_URL=http://localhost:4001`). E2e: `$env:E2E_WEB_URL='http://localhost:3001'; $env:E2E_API_URL='http://localhost:4001'; npx --workspace=@studyfy/web playwright test`.
- Background processes: shell jobs die with the shell — use `Start-Process -WindowStyle Hidden`; kill by CommandLine `*server.js*` (API) vs `*next*` (web). Never run tsc/eslint/vitest IN PARALLEL with the e2e suite (contention → failures).
- The "19.2s baseline" suite claim from an earlier session was unverifiable (old reports gone); realistic green duration on this box is 1.4–1.7m.
- Known externals unchanged: Brevo SMTP 525 (emails don't deliver; auth fails fast now), Cloudinary 503 (uploads disabled by design).
- Design rules held: inline styles only (no Tailwind), no new runtime deps (lucide-react already present), spec-pinned copy/labels/aria/hrefs/logic untouched, spec-pinned navy sidebar + blue kept.

## Repo state right now
YES — all gates green (web+api typecheck/lint 0, root lint 0, API 181/181, e2e 29/29). Web + API servers running (3001/4001) against studyfy_e2e on 3307. Working tree holds this task's full diff — commit pending.

---

## How to use this file (read once, then follow every session)

**At the start of every session, before doing anything else:**
1. Read this file. If `Status: IDLE`, there's no interrupted work — proceed
   to `AGENT_START_HERE.md` normally.
2. If `Status: IN PROGRESS` or `BLOCKED`, resume exactly from "Exact next
   action" below — don't restart the task or re-plan it from scratch, and
   don't assume you remember why a decision was made; if it mattered, it's
   in "Notes" below.
2a. **Before adding any new work on a resumed session, confirm the project
   actually builds and passes its existing tests right now.** An abrupt
   interruption (laptop shut off, crash) can leave a step half-written —
   if the "Repo state right now" line below says anything other than a
   clear YES, fixing that is the next action, not new work.

**While working on a task:**
3. The moment you start a task, set `Status: IN PROGRESS`, fill in
   `Phase / Module`, and list the sub-steps under "What's left."
4. After finishing **each individual sub-step** (not just at the end of the
   whole task — every 10–15 minutes of work, or after every checklist item),
   move it from "What's left" to "What's done" and update "Exact next
   action" to the next concrete thing. This is the actual save point — do
   this every time, it's what makes an abrupt shutdown safe.
5. Prefer small steps that leave the repo in a **buildable, working state**
   when you stop — don't leave a half-written function or a syntax error as
   the last thing on disk if you can help it. If a step genuinely can't be
   split that finely, say so explicitly in "Repo state right now" so the
   next session knows to expect a broken build and fix that first.
6. If you hit a decision point, a blocker, or anything a fresh session
   wouldn't be able to infer from the code alone, write it in "Notes" —
   assume the next session is a different model that has read none of this
   conversation.
7. Commit to git after each sub-step, with a message referencing the spec
   section (`RULES.md` §9) — this is a second, complementary safety net,
   not a replacement for updating this file.

**When the task is fully finished:**
8. Reset this file to the empty template above (`Status: IDLE`, everything
   cleared).
9. Move the actual result into `STATUS.md` (per its Definition of Done,
   `RULES.md` §6.1) — `STATUS.md` tracks *finished* features at the phase
   level; this file tracks the *one task in progress* at the step level.
   Don't let detail pile up in both places.
