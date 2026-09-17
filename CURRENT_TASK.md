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
**Phase / Module:** Phase 1 — Chunk 1 (SIS + Notices)
**Last updated:** 2026-09-17

## What's done in this task so far
- Read CURRENT_TASK.md (IDLE), STATUS.md (all Phase 0 DONE), spec §7 Phase 1 list, AGENT_START_HERE.md Phase 1 note — 2026-09-17
- Baseline re-verified per rule 2a: sandbox mysqld on 3307 had died between sessions — restarted detached (datadir intact), suite 30/30 green before any new work
- Phase 1 groundwork: `documents` table (§9.1: owner FK, cloudinary_url, type) + code TENANT_MODELS entry in the same commit; migrated dev+test, 30/30 still green
- Chunk 1 SIS admission: POST /schools/:schoolId/students (auth→tenant→students.write) creating users row + students row + guardian accounts/links, per-account random temp passwords returned once; new students.write permission seeded (ADMIN/ACCOUNTANT); teacher 403, foreign-section 404, dup-email 409 tested — 35/35 green; matching UI form at /students/new (token-paste dev workflow until login UI)
- Chunk 1 profile: confirmed GET detail chain auth→tenant→students.read→selfScope in code (not assumed); added admin/teacher allow-any-in-school tests — self-scope suite 5/5, full 36/36; profile screen at /students/[id] (own/child/staff views decided server-side, 403 surfaced as-is)
- Chunk 1 roster: sections.classTeacherId added (§9.1 note) + deterministic seed assignments; teacherSectionScope middleware (fail-closed empty); list endpoint upgraded to real server-side sort/page/search/section-filter with meta totals (offset pagination, documented); roster tests (pagination/sort/meta, search, section filter, bad sort 400, teacher-own-sections-only, unassigned-teacher-empty) — 41/41; reusable DataTable (board styling, skeleton rows) + /students list screen
- Chunk 1 documents: Cloudinary upload wired (school folder, random IDs) behind a storage seam — CLOUDINARY_URL unset locally so tests use a recording stub (folder asserted), real provider activates on env; POST (ADMIN/ACCOUNTANT, MIME+ext whitelist → 415, 5MB → 413, foreign owner 404) + GET (staff any, student own, parent linked) with documents.read/write seeded; cross-school proven (403 mismatch + 404 invisible + owner 200) — 46/46
- Chunk 1 ID cards: PDFKit renderer (never Puppeteer) + self-scoped GET .../id-card.pdf endpoint + web print page with @media print (CR80, chrome hidden); Aditya Sharma's card generated live (1804 bytes, %PDF-1.3 … %%EOF), Ramakrishna admin gets 404 on it. Suite flake found + fixed honestly: bcrypt-heavy admission flow timed out under parallel load twice (once with a worker crash) — 30s timeout, green 48/48 twice in a row since.
- SIS end-to-end demo 2026-09-17: admitted Demo Walkthrough (+guardian) via API, viewed profile as admin/student/parent (all 200, correct scoping), upload reached storage layer → honest 503 (no Cloudinary account; full path proven by stub tests), ID card PDF 200/1828 bytes, suite 48/48, demo rows cleaned (0 leftovers), server stopped. Caught live: dev seed was missing documents.* mappings (seed predated them) → re-seeded; own login limiter tripped the demo (5-in-15, working as designed — restarted server to reset the in-memory window).

## What's left in this task
- Chunk 1: SIS #1 (admission, profile, documents, ID cards) + Notices #7 (board + email delivery)
- Chunk 2: Attendance #2 (marking, reports, absentee email alerts) + Homework #6
- Chunk 3: Timetable #5 (generator + teacher_subjects + classTeacherId per new §9.1) + Messaging #8 (1:1, teaching-relationship scope §13.7)
- Chunk 4: Fees #3 (structures/invoices/payments, reminders, PDF receipts) + Exams #4 (marks, rank, PDF report cards)
- Chunk 5: Dashboards #9 (all six, §8 exact) + Public site #10 (§8.3 exact)
- Each chunk: API + tests (both directions) + web UI matched to boards + commit + push

## Exact next action
Chunk 1 kickoff: SIS student admission + profile endpoints (extend probe routes), tests first — say go.

## Notes / decisions made mid-task
- Chunk split (2026-09-17): 10 modules into 5 pairs by weight — C1 SIS+Notices, C2 Attendance+Homework, C3 Timetable+Messaging (teacher_subjects + classTeacherId land in C3 per new §9.1), C4 Fees+Exams (PDF-heavy pair), C5 Dashboards+Public site (needs all data + boards). Adjust only by founder call.
- 2026-09-17: sandbox 3307 was dead at session start (machine sleep/reboot kills detached mysqld) — restarted, datadir intact. Recurring ops note, not a code issue.

## Repo state right now
YES — suite 30/30 green on restarted sandbox; no code changes yet in Phase 1.

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
