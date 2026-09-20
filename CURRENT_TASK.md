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
**Phase / Module:** Phase 1 — Chunk 2 (Fee Management + Exams & Gradebook)
**Last updated:** 2026-09-17

## What's done in this task so far
- Read CURRENT_TASK.md (IDLE), STATUS.md (Chunk 1 DONE) — 2026-09-17
- Baseline: sandbox 3307 dead again at session start — restarted (datadir intact). Fresh-restart flakiness followed: Prisma engine empty-responses + timeouts under default parallel workers → capped vitest maxWorkers=2 (documented in config; suite row-isolated so no semantics change), cleaned 2 leaked TEMP_RBAC_* roles left by killed runs. Green 65/65 three consecutive runs since.
- Chunk 2 fees: term/category columns on fee_structures (category allowlist, migration both DBs); POST /fees/structures (ADMIN/ACCOUNTANT via fees.manage; amount as validated string → Decimal, §13.6); teacher 403, bad amounts 400, dup 409, foreign class 404 — 67/67 green
- Chunk 2 invoices: POST /fees/invoices/generate with exactly-one targeting mode (whole class / section / explicit list); exact structure amount, PENDING default; idempotent skip (never double-bills, skips reported); foreign ids 404, mixed modes 400, cross-tenant 403 — 71/71 green

## What's left in this task
- Fee Management #3 (structures, invoices, payment recording, reminders email, PDF receipts)
- Exams & Gradebook #4 (schedules, marks entry, auto grade/rank, PDF report cards)
- Each: API + tests both directions + web UI + commit + push

## Exact next action
Fee structures + invoices endpoints first (exam/gradebook after) — say go.

## Notes / decisions made mid-task
- 2026-09-17 Chunk 2 open: worker cap + TEMP-role cleanup (see above). Verify every push lands with `git log origin/main`, not just the push line.

## Repo state right now
YES — 65/65 (16 files) three consecutive greens, lint 0, audit-high 0 vulns. Tree clean after this commit.

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
