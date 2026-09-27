# Current Task — Session Handoff

> **Read this file FIRST, before anything else — even before
> `AGENT_START_HERE.md`.** This is the one file that must be updated
> continuously *during* work, not just when a task finishes. Its entire
> purpose: if the laptop shuts off, VS Code closes, or the next session runs
> on a completely different free OpenCode model with zero memory of this
> conversation, that next session can read this file and resume exactly
> where the last one stopped — no guessing, no re-deriving context from
> scratch.

**Status:** IN PROGRESS (live-site debugging — 2 root causes proven: Vercel bundle lacks NEXT_PUBLIC_API_URL (falls back to localhost), Render sends no ACAO for the Vercel origin; both fixes issued, waiting founder)
**Phase / Module:** Deploy — Aiven ✅ → Cloudinary ✅ → Brevo ✅ → Render ✅ (API live) → Vercel ✅ (site serves) → FIX: Vercel env + redeploy (no cache) + Render FRONTEND_ORIGIN → re-run live gate
**Last updated:** 2026-09-27

## What's done in this task so far
- Nothing in progress. Recent finished work (details in `STATUS.md`, bugs in `BUGSFIX.md`):
  - `d066f8d` — premium UI redesign every route (spec 8.2–8.5) + e2e hardening.
  - `3f624d9` + `aadbe6c` — route×role sweep round: 11 bugs fixed (BUGSFIX 22–26).
  - `bf50a1b` + `34da56d` — deep human pass: 9 journey/edge tests (`human.spec.ts`), BUGSFIX 27–28, API 183/183, e2e 38/38.
  - This handoff — **Chunk 5 verification**: landing + enquiry re-checked line-by-line vs §8.3 (all copy exact, all §8.1 exclusions honored, login spec-clean with deliberate no-Google/no-tabs); public.spec 5/5, enquiries API 4/4, full e2e 38/38, both prod builds green, CI already covers gates. No code changes required. Deploy readiness confirmed — actual deploy needs founder accounts (below).

## What's left in this task
- Deploy (FOUNDER ACTION — agent cannot do this): Aiven MySQL account + `DATABASE_URL`, Render account (API), Vercel account (web), Brevo SMTP creds, Cloudinary creds; then spec §1.1 steps 1–9 (`migrate deploy` → Render → Vercel → `FRONTEND_ORIGIN` → live smoke test).
- Scope decision for founder: attendance monthly/term reports UI is the one non-DONE Phase 1 item (`STATUS.md` — API endpoint exists + tested, UI missing). Small build; say the word and it's the next task.

## Exact next action
- None for the agent — founder deploys per spec §1.1, or approves the attendance-reports UI build. Start from `AGENT_START_HERE.md`.

## Notes / decisions made mid-task (carry-over operational knowledge — keep)
- Local API start command (3 override knobs, local-only — never in CI/prod): `cmd /c "set PORT=4001&& set DATABASE_URL=mysql://root@127.0.0.1:3307/studyfy_e2e&& set FRONTEND_ORIGIN=http://localhost:3001&& set JWT_ACCESS_SECRET=dev-access-secret-change-me-please-001&& set LOGIN_RATE_LIMIT_MAX=200&& set REGISTER_RATE_LIMIT_MAX=200&& set ENQUIRY_RATE_LIMIT_MAX=200&& node dist/server.js"` (workdir `apps/api`). Web: `npx next start --port 3001` in `apps/web` (built with `NEXT_PUBLIC_API_URL=http://localhost:4001` — running it from repo root exits silently). E2e: `$env:E2E_WEB_URL='http://localhost:3001'; $env:E2E_API_URL='http://localhost:4001'; npx --workspace=@studyfy/web playwright test`.
- Background processes: shell jobs die with the shell — use `Start-Process -WindowStyle Hidden`; kill by CommandLine `*server.js*` (API) vs `*next*` (web). Never run tsc/eslint/vitest IN PARALLEL with the e2e suite (contention → failures).
- Local suite reality: green duration ~1m warm (38 tests; first cold run up to ~3m); `retries: 1` absorbs machine stalls (a genuine regression fails both attempts — trace showed one 38s server-side stall once).
- MySQL sandbox (3307) can silently die mid-session; recovery: kill the stale `mysqld`, then `Start-Process -FilePath "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe" -ArgumentList "--datadir=C:\Users\kavad\studyfy-mysql-data","--port=3307","--bind-address=127.0.0.1","--mysqlx=OFF"` (mysqld is NOT on PATH). Datadir persists — no re-seed needed. The MySQL80 service on 3306 is unrelated — never touch it. Symptom: API tests fail suite-wide with "Can't reach database server at 127.0.0.1:3307".
- Known externals unchanged: Brevo SMTP 525 (emails don't deliver; fails fast), Cloudinary 503 (uploads disabled by design).
- Design rules: inline styles only (no Tailwind), no new runtime deps (lucide-react present), spec-pinned copy/labels/aria/hrefs/nav untouched, navy sidebar + blue `#2563EB` kept.

## Repo state right now
- YES — clean tree (this handoff is the last commit), Chunk 5 verified with zero code changes (public.spec 5/5, enquiries 4/4, e2e 38/38, both prod builds green). Web + API servers running (3001/4001) against `studyfy_e2e` on 3307. Demo login: slug `school-of-science`, password `Demo@1234` (see `DEMO_DATA.md`).

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
