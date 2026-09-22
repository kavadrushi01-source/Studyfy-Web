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
**Phase / Module:** Phase 1 — Chunk 4 (Messaging + Dashboards)
**Last updated:** 2026-09-22

## What's done in this task so far
- Read CURRENT_TASK.md (IDLE) + STATUS.md (Chunk 3 DONE) — 2026-09-21
- Baseline per rule 2a: DB up, tree clean; suite 117/117 green direct (one npm-wrapper flake, known transient)
- Chunk 4 realtime: Socket.io server (§12.5) — handshake verifies access JWT, school_id derived server-side, dynamic /school-<id> namespace must match the token (mismatch/garbage/missing/owner rejected pre-join); http.Server rewire + room join + ready ack — 120/120 green
- Chunk 4 messaging: Message model + migration + code TENANT_MODELS (same commit — founder's backup f71840b preserved underneath); §13.7 matrix (unrelated-teacher 403 both ways, no student-student, admin reads-only-oversight); threads endpoint (previews + unread, admin sees all); message:new emit on send; /messages UI with always-visible Live/Reconnecting/Offline banner — 125/125 green
- Chunk 4 live-delivery proof: message-realtime.test.ts (client joins school room over socket, pupil sends via HTTP, message:new arrives with matching threadId/sender/body) — caught a REAL bug: emitToSchool broadcast from root io, but rooms live in /school-<id> namespaces (event silently lost); fixed to emit via the dynamic namespace object — 126/126 green, typecheck + lint clean
- Regression sweep pre-Dashboards (2026-09-22): full suite 129/129 (40 files) local; CI red on 0a9d285 — same P2002 seed race seen in older runs (parallel workers, non-atomic upsert in seedRoles/seedPermissions); reproduced locally (delete-LIBRARIAN worst case → P2002 on demand), fixed root cause (atomic createMany+skipDuplicates, idempotent updates, retry on P2002/P2034 only) + seed-concurrency.test.ts + BUGSFIX.md #13/#14

## What's left in this task
- Dashboards #9 (all six role boards, §8 exact: sidebar, KPIs, panels)
- (Public site #10 stays Chunk 5)

## Exact next action
Dashboards #9 next (all six role boards, §8 exact: sidebar, KPIs, panels) — say go.

## Notes / decisions made mid-task
- Chunk 4 opened 2026-09-21 after 117/117 baseline re-verify.
- Messaging E2E demo: Arjun→Aditya (linked) 201, Arjun→Priya (10-A, unlinked) 403, Aditya replies 201, Kavita oversight reads full thread (2 msgs); demo rows deleted, server stopped.
- Session recovered mid-messaging-task: founder's backup commit f71840b (Message model + code TENANT_MODELS + seed keys) verified intact, tree clean — continued on top of it, nothing rewritten. Migration add-messages + endpoints + matrix built after.
- Messaging design: threadId = sorted pair key; §13.7 matrix in mayMessage (student→linked-teacher, parent→linked-teacher, teacher→linked-student/parent, everything else denied); admin reads any participant's threads (oversight) but holds no send key.
- 2026-09-22 contradiction resolved: "Done" 125/125 was correct (threads commit 234a8bb added message-threads.test.ts + /messages UI after the 123/123 line was written in 214e460 and never updated); "Left" Messaging #8 + old next-action were stale — messaging verified complete in code + 125/125 direct run, so #8 moved out of "Left" and next action reset to Dashboards #9. Minor known gap: message:new is emitted on send (router) but no test asserts live socket delivery — HTTP threads cover correctness.

## Repo state right now
YES — 129/129 green (40 files, verified direct 2026-09-22), lint 0, typecheck 0, both DBs migrated. Sandbox MySQL on 3307. CI re-run pending on seed-race fix.

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
