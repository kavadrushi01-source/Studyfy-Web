# Current Task — Session Handoff

> **Read this file FIRST, before anything else — even before
> `AGENT_START_HERE.md`.** This is the one file that must be updated
> continuously *during* work, not just when a task finishes. Its entire
> purpose: if the laptop shuts off, VS Code closes, or the next session runs
> on a completely different free OpenCode model with zero memory of this
> conversation, that next session can read this file and resume exactly
> where the last one stopped — no guessing, no re-deriving context from
> scratch.

**Status:** IDLE (deep human pass complete — fixes in `bf50a1b`, pushed with this handoff)
**Phase / Module:** —
**Last updated:** 2026-09-27

## What's done in this task so far
- Nothing in progress. Recent finished work (details in `STATUS.md`, bugs in `BUGSFIX.md`):
  - `d066f8d` — premium UI redesign every route (spec 8.2–8.5) + e2e hardening.
  - `3f624d9` + `aadbe6c` — route×role sweep round: 11 bugs fixed (BUGSFIX 22–26), sweep spec created, run clean, deleted.
  - `bf50a1b` + this handoff — **deep human pass** (2026-09-27): 9 new journey/edge tests kept permanently as `e2e/human.spec.ts` (temp-password admit→login, roster search/sort/paginate, payment zero-reject, attendance day-reopen persistence, class-targeted notice scoping, over-max marks refusal, signed-out gates/404/session/back-after-logout, 390px viewport, all-6-roles nav walk with zero-console-error assertion); found + fixed BUGSFIX 27–28 (attendance hydration via new `GET /attendance` roster endpoint + `aria-pressed` pills; typed-marks-only save — blank inputs were being sent as zeros). Verification: e2e **38/38** twice consecutive (one stall-retry run absorbed), API **183/183**, all gates 0.

## What's left in this task
- Nothing. Next founder-gated task: Chunk 5 (public site/deploy/Phase-1 close-out, spec §7 Phase 1 #10).

## Exact next action
- None — start from `AGENT_START_HERE.md`.

## Notes / decisions made mid-task (carry-over operational knowledge — keep)
- Local API start command (3 override knobs, local-only — never in CI/prod): `cmd /c "set PORT=4001&& set DATABASE_URL=mysql://root@127.0.0.1:3307/studyfy_e2e&& set FRONTEND_ORIGIN=http://localhost:3001&& set JWT_ACCESS_SECRET=dev-access-secret-change-me-please-001&& set LOGIN_RATE_LIMIT_MAX=200&& set REGISTER_RATE_LIMIT_MAX=200&& set ENQUIRY_RATE_LIMIT_MAX=200&& node dist/server.js"` (workdir `apps/api`). Web: `npx next start --port 3001` in `apps/web` (built with `NEXT_PUBLIC_API_URL=http://localhost:4001` — running it from repo root exits silently). E2e: `$env:E2E_WEB_URL='http://localhost:3001'; $env:E2E_API_URL='http://localhost:4001'; npx --workspace=@studyfy/web playwright test`.
- Background processes: shell jobs die with the shell — use `Start-Process -WindowStyle Hidden`; kill by CommandLine `*server.js*` (API) vs `*next*` (web). Never run tsc/eslint/vitest IN PARALLEL with the e2e suite (contention → failures).
- Local suite reality: green duration ~1m warm (38 tests; first cold run up to ~3m); `retries: 1` absorbs machine stalls (a genuine regression fails both attempts — trace showed one 38s server-side stall once).
- MySQL sandbox (3307) can silently die mid-session; recovery: kill the stale `mysqld`, then `Start-Process -FilePath "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe" -ArgumentList "--datadir=C:\Users\kavad\studyfy-mysql-data","--port=3307","--bind-address=127.0.0.1","--mysqlx=OFF"` (mysqld is NOT on PATH). Datadir persists — no re-seed needed. The MySQL80 service on 3306 is unrelated — never touch it. Symptom: API tests fail suite-wide with "Can't reach database server at 127.0.0.1:3307".
- Known externals unchanged: Brevo SMTP 525 (emails don't deliver; fails fast), Cloudinary 503 (uploads disabled by design).
- Design rules: inline styles only (no Tailwind), no new runtime deps (lucide-react present), spec-pinned copy/labels/aria/hrefs/nav untouched, navy sidebar + blue `#2563EB` kept.

## Repo state right now
- YES — clean tree (this handoff is the last commit), all gates green (web+api typecheck/lint 0, root lint 0, **API 183/183**, **e2e 38/38 ×2** — 29 flow specs + 9 `human.spec.ts`). Web + API servers running (3001/4001) against `studyfy_e2e` on 3307. Demo login: slug `school-of-science`, password `Demo@1234` (see `DEMO_DATA.md`).

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
