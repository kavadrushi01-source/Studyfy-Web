# Current Task — Session Handoff

> **Read this file FIRST, before anything else — even before `AGENT_START_HERE.md`.** This file is updated continuously *during* work. If the laptop shuts off or a fresh session starts with zero memory, reading this file must be enough to resume exactly where the last session stopped.

## STATUS: LAYER 4 COMPLETE — no work in progress

**Full evidence: `docs/testing/LAYER4_REPORT.md`** (Layer 3 report in `docs/testing/LAYER2_REPORT.md` §12 remains accurate).
**Verdict: GO** for demo/portfolio use. **CONDITIONAL** for real payments until `PLATFORM_GSTIN` / `PLATFORM_STATE` are set on Render.

### Session 5 (Layer 4) summary

- Every demo role of both schools driven through every module live, checking data
  outcomes, not just status codes. Budgets stayed inside the Layer-2 caps.
- **One real bug found and fixed:** a teacher could read a foreign-section pupil's
  full record by id (`/students/:id`, `/id-card`, `/attendance/summary?studentId=`)
  while the list route was correctly scoped. Fixed with the same `teacherSectionScope`
  lens + 404s; `self-scope.test.ts` rewritten to pin the real policy; new
  `teacher-scope-regress.test.ts`. Full API suite **499/499** green locally, lint +
  typecheck 0. BUGSFIX entry **#88**.
- A handful of earlier-suspicion items were re-classified **by design with live
  evidence** (teacher list scoping shapes, parent messaging gates, RK STANDARD plan
  matrix, export limiter, certificates read gates).
- **Demo data restored to its exact pre-session baseline** and verified table-by-table
  (students 16, users 52, notices 6, invoices 16, payments 14, attendance 363,
  books 16, transport 5/5/1, timetable 60/60…). The timetable needed a small
  exact-cover rebuild to return to 60 zero-conflict slots — LAYER4_REPORT §5 explains.
  `audit_logs` left append-only; probe sessions pruned from `refresh_tokens`.
- Earlier-in-session finds landed as BUGSFIX **#87** (owner "Please sign in" card) — commit `340f9ee`.

Latest commits (all pushed; each re-verified against the live site):
- `da61f67` — unmatched API routes answer with the JSON envelope (BUGSFIX 81)
- `bb3f7f5` — web hardening headers in `next.config.js`
- `caabb6f` — librarian / transport manager log in and reach a real board (BUGSFIX 82)
- `816deed` — the staff dashboard page itself (BUGSFIX 83/84)
- `f7040b4` — notices can be edited and withdrawn (BUGSFIX 85, incl. the `PATCH {}` schema bug)
- `7342261` + `7d45519` — seed-race triage + notice schema regression (BUGSFIX 86, session 4)
- `340f9ee` — no more "Please sign in" said to a signed-in owner on school pages (BUGSFIX 87, session 4)
- Layer 4 fix commit (BUGSFIX 88) pushed after this handoff was written — see git log
- Layer 1 remains complete and tagged `layer-1-complete` at `ce2f391`

## Where each layer stands

1. **Layer 2** — deployment audit via the live database: 4 blockers fixed (demo hashes never rotated, Ramakrishna School missing, LIBRARIAN/TRANSPORT logins missing, production 4 migrations behind), 2 demo schools + platform owner only, all `createci` junk removed, **GO** verdict.
2. **Layer 3** — browser sweep, 477 roleA-route combinations on Chromium/Firefox/WebKit: 9/9 logins, wrong-role boards 403, cross-tenant 404, plan gating holds; all flagged items were correct RBAC/tenant behaviour. It found the 3 real bugs above (plus the schema bug inside #85, caught by its own regression test).
3. **Layer 4** — full human pass, every role × every module with data-verity checks: found and fixed the teacher-scope read leak (BUGSFIX 88), re-classified the rest by design, and restored the demo data to its exact baseline. **GO** verdict reaffirmed.

## Test-suite reality (Windows dev box)

`npm run test --workspace=@studyfy/api` runs clean locally — `TEST_DATABASE_URL` must point at the local MySQL80 instance on `127.0.0.1:3306`, database `studyfy_test` (migrated 45/45). The non-zero exits that remain are a known Windows-native Prisma engine crash inside a random fork worker (exit `3221226505`, kills a different file each run — `auth`+`teacher-dashboard`, then `admission`); assertions never failed. CI on Linux has never shown it. Never commit the DB password; it is held out-of-band by the operator.

## Commands that matter

Run from the **repo root**, with `DATABASE_URL` and `DEMO_PASSWORD` in the environment:

```powershell
npm run db:reset-demo-passwords --workspace=@studyfy/api   # rotate demo hashes ONLY
npm run db:seed --workspace=@studyfy/api                   # re-seed both demo schools
npx prisma migrate deploy                                   # apply pending migrations
```

**Setting `DEMO_PASSWORD` on the host does NOT change existing hashes** — you must run the reset script. `npx prisma db seed` / `npx prisma seed` do **not** invoke this project code and will fail; don't retry them.

## Open items (not blocking)

1. **Web CSP** — deliberately not enforced. Next.js emits inline hydration scripts; needs a per-route inventory plus a `Content-Security-Policy-Report-Only` rollout. Blind enforcement risks a white screen.
2. **`users.school_id` is `ON DELETE SET NULL`** — deleting a school orphans its admins into platform-level accounts (login treats a missing slug as a platform lookup, `auth.service.ts:233`). Contained today by tenant middleware (`tenant.ts:24`), but it is a latent escalation path. Needs a migration decision.
3. **Cron jobs never fired live** — `CRON_SECRET` was unavailable this pass. Logic is unit-tested; live execution unverified.
4. **No email confirmed received** — only the API contract (and its anti-enumeration behaviour) was verified.
5. **Cloudinary** — deleted probe uploads may still exist as orphaned remote assets (DB rows gone, blobs not).

## Founder actions

1. Set `PLATFORM_GSTIN` and `PLATFORM_STATE` on Render — required before any real invoice.
2. **Rotate the Aiven and Cloudinary credentials** — they were pasted into chat and a local file during this window. The local files are deleted, but rotate regardless; chat history persists.
3. Consider `ON DELETE RESTRICT` on `users.school_id` (open item 2).
4. Render free tier has no Shell / One-Off Jobs — rotation and seeding must be run from a machine holding the database URL.

## Cleanup state

Done: all temporary credential/token files deleted, both Layer 2 test schools and e2e leftovers removed, probe documents deleted, stray payment intents and test students removed. `secret.md` was gitignored, never committed, and deleted entirely at the end of the Layer-4 session. No secrets appear in the report or in any committed doc. Future sessions needing the production DB URL should ask the founder for it out-of-band.
