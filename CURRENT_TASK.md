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
**Phase / Module:** Phase 1 — Chunk 3 (Timetable + Homework)
**Last updated:** 2026-09-21

## What's done in this task so far
- Read CURRENT_TASK.md (IDLE), STATUS.md (Chunk 2 DONE) — 2026-09-21
- Baseline per rule 2a: sandbox 3307 dead again — restarted (datadir intact), suite 96/96 green, tree clean
- Chunk 3 qualifications: staff.manage key (ADMIN-only) + POST/GET/DELETE .../teachers/:staffId/subjects (TEACHER-role enforced, dup 409, foreign 404s, teacher-caller 403) — 98/98 green
- Chunk 3 generator: pure DSATUR-ordered greedy coloring lib (unit: zero-conflict solve, partial+reasons, fair tie handling, determinism, sub-second termination) + POST .../timetable/generate (persist+replace, timetable.manage ADMIN-only) — 105/105 green
- Chunk 3 manual slots: POST/DELETE .../timetable/slots enforcing generator invariants (section/teacher double-book 409s) PLUS qualification (409, fixable via qualifications endpoint — one source of truth); foreign 404s, teacher 403 — 107/107 green

## What's left in this task
- Timetable #5 (auto-generation per §10 graph coloring + teacher_subjects + views)
- Homework #6 (post, submit, grade + views)
- (Notices #7 already DONE in Chunk 1 — no rework; Messaging #8 folds into Chunk 4)

## Exact next action
Timetable generation first (teacher_subjects table + generator + scope) — say go.

## Notes / decisions made mid-task
- 2026-09-21 Chunk 3 open: user listed "Timetable + Homework + Notices" — Notices already DONE (Chunk 1), so Chunk 3 = Timetable #5 + Homework #6; Messaging #8 moves to Chunk 4.
- Teacher-qualification check: NO confusion needed — the user's own spec update (e8ddd83) already plans teacher_subjects for Chunk 3; reference list already had it. Implemented: model + migration + code TENANT_MODELS (same commit) + 19 deterministic seed rows from DEMO_DATA.md teacher/subject lists.
- Honest correction: tests-tsconfig has been RED since exam-results.test.ts landed (4 unchecked-index errors) — earlier "typecheck clean" reads were truncated tails hiding them. Fixed + verified full output now. Rule stands: read FULL command output, never trust tail-only reads for pass/fail.

## Repo state right now
YES — 96/96 green on restarted sandbox; no code changes yet in Chunk 3.

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
