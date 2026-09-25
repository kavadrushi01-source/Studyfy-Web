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
**Phase / Module:** Web sessions + profiles + logout (founder testing friction)
**Last updated:** 2026-09-24

## What's done in this task so far
- Sessions (2026-09-24): POST /auth/logout (revokes chain, clears cookie, never 401s) + auth-logout.test.ts; AuthProvider (login/logout/silent+proactive refresh/persist) in root layout; all 6 dashboards + 14 module pages off paste-boxes onto useAuth/apiFetch (timetable staff-ID kept — readBoard requires teacherId); sidebar logout; /profile page + Profile nav live (Teacher/Student/Parent); login via context (token box dropped). Verified: 167/167 (49 files), root lint 0, typecheck 0, web build (/profile prerendered); live cookie chain proven (login→refresh rotates→board→logout→refresh 401).

## What's left in this task
- (none — Chunk 5 next, see Exact next action)

## Exact next action
Chunk 5 — public site, deploy, and Phase 1 close-out (spec §7 Phase 1 #10) — say go.

## Notes / decisions made mid-task
- Homework pending freeze (2026-09-24, founder felt homework broken): submitHomework never invalidated the teacher board (post+grade did) — count lagged to TTL; fixed + regression test; live 6→7 instant. Module files 16/16 green on re-run; full live chain green (mark/post/submit/grade/marks/msg/threads/notice); file uploads need Cloudinary creds (503 by design, text path green). BUGSFIX.md #18.
- Module re-check 2026-09-24 (founder felt attendance/homework/marks/messages/notices broken): integration files 16/16 green on re-run (one transient parallel flake first run, unreproduced); live dev chain ALL GREEN (mark 200, post 201, submit 201, grade 200, marks 200, linked-msg 201, threads 200, notice 201 + board sees it, demo rows cleaned). Nothing broken — likely felt causes: 15-min access tokens expiring mid-session (re-login fixes), Brevo SMTP 525 from this IP (posts save, emails undelivered — known since Chunk 3).
- Slug-vs-ID confusion (2026-09-24, founder pasted slug into School ID box → bare "Forbidden."): TENANT_MISMATCH message now names the cause + login screen shows the copyable school ID. Verified live (code + message proven).
- UI/UX remediation pass 2026-09-24 (founder-directed, pre-Chunk-5): audited every page vs §8.2–§8.5 text (docs/designs/ absent from repo — no images exist to compare against). Fixed: shared Shell + role-boards config + EmptyState/SkeletonBlocks/Card (all 6 dashboards adopted), globals.css tokens/breakpoints/shimmer, Inter + viewport in layout, lucide-react installed (audit 0), KPI 24 unified, chart empty branches, owner revenue/plans wired live, parent upcoming-exams noted as single-nextExam (API shape — kept honest), homework post/submit/grade UI + notice audience targeting built against verified endpoints, messages stacks + real Retry, print kept only where meaningful (ID card; report/receipts print via PDF viewer by design), teal/brown pill colors remapped to spec, dead onSort/onPage left wired (DataTable requires props), dev page font/logo fixed, landing shadows + feature icons + responsive grids. Deliberate keeps: inline styles (no Tailwind migration), report/receipt window.open flow + pop-up fallback. Verified: 166/166 (48 files), root lint 0, typecheck 0, api+web builds clean, live teacher page 200 + login OK; no API logic touched (git diff on apps/api empty).

## What's left in this task
- Deploy definition + execution (env secrets, production DB migrate, owner seed, live smoke)
- Phase 1 close-out (final suite + CI green, STATUS/CURRENT_TASK wrap-up)

## Exact next action
Chunk 5 — public site, deploy, and Phase 1 close-out (spec §7 Phase 1 #10) — say go.

## Notes / decisions made mid-task
- Module 9 verification pass 2026-09-23: suite 162/162 (47 files) local ×3 consecutive green (2 earlier parallel-load flakes, no captured identity, unreproduced since); CI all-5-green on 29720fc; bundle cache proven (stale-proof + same-read reads); all boards static-checked vs §8.3/§8.4 (docs/designs/ absent — text only); live both-schools matrix (distinct KPIs/feeds per tenant, Arjun 9-A-only, Suresh→Aditya/Sunita→Krishna-only, owner sees both, all cross-tenant 403, revenue 0.00/plans []); module E2E group 27 files/74 tests green. Fixed en route: CI lint failure (unused var in teacher-dashboard.test.ts — workspace lint skips tests/, root lint doesn't; BUGSFIX.md #15 + process rule: gate on root lint).

## Repo state right now
YES — 166/166 green local (48 files), root lint 0, typecheck 0, api+web builds clean (incl. remediation: lucide-react, audit 0), both DBs migrated + dev re-seeded. Sandbox MySQL on 3307, datadir C:\Users\kavad\studyfy-mysql-data.

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
