# Current Task — Session Handoff

> **Read this file FIRST, before anything else — even before
> `AGENT_START_HERE.md`.** This is the one file that must be updated
> continuously *during* work, not just when a task finishes. Its entire
> purpose: if the laptop shuts off, VS Code closes, or the next session runs
> on a completely different free OpenCode model with zero memory of this
> conversation, that next session can read this file and resume exactly
> where the last one stopped — no guessing, no re-deriving context from
> scratch.

**Status:** IN PROGRESS
**Phase / Module:** Phase 0
**Last updated:** 2026-09-16

## What's done in this task so far
- Read CURRENT_TASK.md, AGENT_START_HERE.md, STUDYFY_PROJECT_SPEC.md (full v3.2), RULES.md (full v3.2) — 2026-09-16
- Step 0 analysis: read SECURITY_PATTERNS.md + ci.yml (at repo root, not .github/workflows/) and listed path/script assumptions
- Scaffolded monorepo per spec §19: root workspaces + tsconfig.base (strict, noUncheckedIndexedAccess), apps/api (Express hello + /health, vitest), apps/web (Next 14 App Router blank page), packages/shared-types (envelope), prisma/ placeholder — lint+typecheck+test+build all green, both servers verified running
- Full core schema §9.1 written + migrated (20260916041047_init_core_schema, 23 models, 24 tables) — validate clean, migrate status in-sync, smoke-tested TRIAL/Asia/Kolkata defaults
- Auth (register/login/refresh) built + tested: raw-client register with collision-safe slug, optional-slug login (absent = Platform Owner), opaque 7d refresh rotation with reuse→chain-kill, bcrypt-12, 15m JWT, gates for SUSPENDED/TRIAL-expired/disabled — 12/12 tests green
- tsconfig strict + noUncheckedIndexedAccess set explicitly in both workspaces, typecheck 0 errors

## What's left in this task
- Tenant/platform/RBAC/self-scope middleware + tests first, seed demo schools (DEMO_DATA.md), hardening, CI green

## Exact next action
Tenant middleware + Prisma scoping extension + cross-tenant regression test FIRST (SECURITY_PATTERNS.md §1) — say go to start it.

## Notes / decisions made mid-task
- Step 0 finding 2026-09-16: ci.yml lives at repo ROOT, but spec §19 + SECURITY_PATTERNS.md §4 assume `.github/workflows/ci.yml` — must move it there or CI never runs.
- Scaffold 2026-09-16: Next pinned 14.2.35 (was 14.2.5, has published vuln). Audit still reports 1 high + 1 critical on next/postcss chain — only clean fix is next 16.3.5 + React 19 (breaking, needs `next lint` removal). Deferred to pre-CI-green step.
- Debts cleared 2026-09-16: (1) ci.yml moved to .github/workflows/ci.yml via git mv. (2) web upgraded next 14.2.35→16.3.5 + react/react-dom 18→19 + @types/react(-dom) 19, web `lint` switched `next lint`→`eslint .`; api vitest 2→5.0.1 + @types/node 20→24 (vitest 5 peer requirement). `npm audit --audit-level=high` now exits 0, 0 vulns. Remaining moderate-only vitest notices gone too. No other code touched.
- Node local 24.15.0 vs CI 20 — .nvmrc pins 20 for CI parity.
- Verified: GET /api/v1/hello + /health return envelope; web `next start` serves / (HTML checked).
- Schema+migration 2026-09-16: prisma pinned 6.12.0 (NOT 6.19.x — 6.13+ pulls @prisma/config→deepmerge-ts HIGH audit fail; 6.12.0 is audit-clean, client+CLI matched pair). DB = local sandbox mysqld on 127.0.0.1:3307 (datadir in Temp/opencode/studyfy-mysql-data, root/empty pw, db studyfy_dev) — started detached via Start-Process so it survives shell exits; restart cmd in Notes history if port goes dead. Local MySQL80 (3306) credentials unknown — untouched. .env files gitignored; CI uses its own mysql:8 service. trialEndsAt has NO db default by design (registration code must set now+14d); updated_at is Prisma-managed (@updatedAt), raw SQL inserts must supply it.

## Repo state right now
YES — auth done: lint 0, typecheck x4 (api src+tests, web, shared), api tests 12/12, api build + audit-high 0 vulns. Test DB studyfy_test on sandbox 3307 (migrated + roles seeded); tests force TEST_DATABASE_URL so dev DB is never touched.

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
