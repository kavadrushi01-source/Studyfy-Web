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
**Phase / Module:** Phase 1 — Chunk 5 (Public site → deploy → close-out)
**Last updated:** 2026-09-23

## What's done in this task so far
- Chunk 5 public site (§7 #10, §8.3): POST /enquiries already existed — added 4 tests (store, contact variants, 404/400, honeypot silence); web landing (spec-exact copy, exclusions honored), /login (no tabs, no dead buttons, token handoff), /signup 3-step wizard against live register schema, /enquiry form; dev index → /dev. Verified: 166/166 (48 files), root lint clean, web build prerenders all routes; live (stored 201, 404 bad slug, honeypot stored nothing, demo row deleted after).
- Login crash fix (2026-09-24, found by founder hand-testing): `"error" in body` is true on EVERY API success (envelope always carries `error: null`) — login + all 19 data pages crashed exactly when calls succeeded. Shared `isFailure()` guard in web/lib/api.ts, 19 files, typecheck+lint+build clean, success+failure paths proven live. BUGSFIX.md #16.
- Login limiter vs hand-testing (2026-09-24): founder blocked at 5 logins mid-session. Default stays 5 (CI/prod untouched); gitignored local .env raises it to 200 via new LOGIN_RATE_LIMIT_MAX override (documented never-for-production). Rebuilt, restarted, 7/7 rapid logins proven live. BUGSFIX.md #17.

## What's left in this task
## What's left in this task
- Deploy definition + execution (env secrets, production DB migrate, owner seed, live smoke)
- Phase 1 close-out (final suite + CI green, STATUS/CURRENT_TASK wrap-up)

## Exact next action
Define the deploy checklist, then execute it — say go.

## Notes / decisions made mid-task
- Module 9 verification pass 2026-09-23: suite 162/162 (47 files) local ×3 consecutive green (2 earlier parallel-load flakes, no captured identity, unreproduced since); CI all-5-green on 29720fc; bundle cache proven (stale-proof + same-read reads); all boards static-checked vs §8.3/§8.4 (docs/designs/ absent — text only); live both-schools matrix (distinct KPIs/feeds per tenant, Arjun 9-A-only, Suresh→Aditya/Sunita→Krishna-only, owner sees both, all cross-tenant 403, revenue 0.00/plans []); module E2E group 27 files/74 tests green. Fixed en route: CI lint failure (unused var in teacher-dashboard.test.ts — workspace lint skips tests/, root lint doesn't; BUGSFIX.md #15 + process rule: gate on root lint).

## Repo state right now
YES — 166/166 green local (48 files), root lint 0, typecheck 0, api+web builds clean, both DBs migrated + dev re-seeded (enquiries 0 after live-test cleanup). Sandbox MySQL on 3307, datadir C:\Users\kavad\studyfy-mysql-data.

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
