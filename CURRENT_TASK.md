# Current Task — Session Handoff

> **Read this file FIRST, before anything else — even before
> `AGENT_START_HERE.md`.** This is the one file that must be updated
> continuously *during* work, not just when a task finishes. Its entire
> purpose: if the laptop shuts off, VS Code closes, or the next session runs
> on a completely different free OpenCode model with zero memory of this
> conversation, that next session can read this file and resume exactly
> where the last one stopped — no guessing, no re-deriving context from
> scratch.

**Status:** IDLE (§13.8 idempotency gap closed — pushed with this handoff)
**Phase / Module:** —
**Last updated:** 2026-09-27

## What's done in this task so far
- Nothing in progress. Recent finished work (details in `STATUS.md`, bugs in `BUGSFIX.md`):
  - `d066f8d` — premium UI redesign every route (spec 8.2–8.5) + e2e hardening.
  - `3f624d9` + `aadbe6c` — route×role sweep round: 11 bugs fixed (BUGSFIX 22–26).
  - `bf50a1b` + `34da56d` — deep human pass: 9 journey/edge tests (`human.spec.ts`), BUGSFIX 27–28, API 183/183, e2e 38/38.
  - `f2150c3` + `9e6f38c` — Chunk 5 verification (marketing+enquiry vs §8.3, zero code changes).
  - `f2150c3` + `88cb8e3` + `fe17da3` — **LIVE DEPLOY + GATE**: Aiven MySQL (migrated + seeded), Render API + Vercel web live, 2 live blockers fixed (Vercel env, CORS), 6-test live gate green, login limiter restored.
  - This handoff — **attendance reports UI** (last Phase-1 gap): new `/attendance/reports` (month + custom from/to + staff section filter, range caption, empty states, pupil self-scope, no staff 403s) + reports link on the mark page; 2 new e2e (admin month/section/empty/range journey, pupil self-only). Verified: e2e **40/40**, web gates 0. `STATUS.md` Attendance row → DONE.
  - Founder acceptance 2026-09-27: personally verified Phase 1 end-to-end on the live site — declared complete. Phase 2 queued for next session (Razorpay test mode, SMS/WhatsApp stub, library, transport, payroll, CRM, certificates) — NOT started.
  - `0c3cff3` + `f181171` — **homework submit-scope fix** (founder-found): pupil submit boxes were rendering for every role; submit block now STUDENT-gated. Arjun teaches Mathematics (Astronomy refusal was correct validation). BUGSFIX 29.
  - `7f6c476` — **role-depth round** (teacher/student/parent, human-level): 8 new e2e, zero product bugs, teacher.spec presence-assert fix. Verified: e2e **49/49**, web TC+lint 0.
  - `a80cd8c` — **responsive round**: 390px sweep found 3 overflows (landing header +253px, dashboard cards +9px, message threads +26px), all fixed, re-sweep 0px. BUGSFIX 30.
  - `2aff06b` — **mobile-menu round**: collapsible sidebar on phones, e2e 49/49. BUGSFIX 31.
  - This handoff — **§13.8 idempotency gap** (Phase 2 prep): `providerOrderId` had no unique/index and nothing looked payments up by provider ids. Now both ids UNIQUE (NULL-safe for counter payments), new `findPaymentByProviderId` (resolves invoice+school for the future webhook), migration applied to all local DBs, 3 new API tests (lookup both ways, NULL coexistence, duplicate rejection). Verified: API **186/186**, gates 0.

## What's left in this task
- Founder items: (1) rotate secrets pasted in chat (Aiven password, Cloudinary key, Brevo SMTP key — regenerate each, update Render env); (2) pilot with a real school; (3) Phase 2 kickoff next session — Razorpay TEST MODE first (spec §7 #12), per spec never live keys.
- Watch items: Aiven free sleeps when idle (power on from console if DB errors); Render free cold-starts ~50s; Brevo freemail sender may land in spam (custom domain + DKIM later).

## Exact next action
- None for the agent — next session starts Phase 2 (Razorpay TEST MODE first). Start from `AGENT_START_HERE.md`.

## Notes / decisions made mid-task (carry-over operational knowledge — keep)
- Local API start command (3 override knobs, local-only — never in CI/prod): `cmd /c "set PORT=4001&& set DATABASE_URL=mysql://root@127.0.0.1:3307/studyfy_e2e&& set FRONTEND_ORIGIN=http://localhost:3001&& set JWT_ACCESS_SECRET=dev-access-secret-change-me-please-001&& set LOGIN_RATE_LIMIT_MAX=200&& set REGISTER_RATE_LIMIT_MAX=200&& set ENQUIRY_RATE_LIMIT_MAX=200&& node dist/server.js"` (workdir `apps/api`). Web: `npx next start --port 3001` in `apps/web` (built with `NEXT_PUBLIC_API_URL=http://localhost:4001` — running it from repo root exits silently). E2e: `$env:E2E_WEB_URL='http://localhost:3001'; $env:E2E_API_URL='http://localhost:4001'; npx --workspace=@studyfy/web playwright test`.
- Background processes: shell jobs die with the shell — use `Start-Process -WindowStyle Hidden`; kill by CommandLine `*server.js*` (API) vs `*next*` (web). Never run tsc/eslint/vitest IN PARALLEL with the e2e suite (contention → failures).
- Local suite reality: green duration ~1-2m warm (49 tests; first cold run up to ~4m); `retries: 1` absorbs machine stalls (a genuine regression fails both attempts — trace showed one 38s server-side stall once).
- MySQL sandbox (3307) can silently die mid-session; recovery: kill the stale `mysqld`, then `Start-Process -FilePath "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe" -ArgumentList "--datadir=C:\Users\kavad\studyfy-mysql-data","--port=3307","--bind-address=127.0.0.1","--mysqlx=OFF"` (mysqld is NOT on PATH). Datadir persists — no re-seed needed. The MySQL80 service on 3306 is unrelated — never touch it. Symptom: API tests fail suite-wide with "Can't reach database server at 127.0.0.1:3307".
- Known externals unchanged: Brevo SMTP 525 (emails don't deliver; fails fast), Cloudinary 503 (uploads disabled by design).
- Design rules: inline styles only (no Tailwind), no new runtime deps (lucide-react present), spec-pinned copy/labels/aria/hrefs/nav untouched, navy sidebar + blue `#2563EB` kept.

## Repo state right now
- YES — clean tree (this handoff is the last commit), role-depth + responsive + mobile-menu rounds (e2e 49/49, web gates 0). Web + API servers running (3001/4001) against `studyfy_e2e` on 3307. Demo login: slug `school-of-science`, password `Demo@1234` (see `DEMO_DATA.md`).

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
