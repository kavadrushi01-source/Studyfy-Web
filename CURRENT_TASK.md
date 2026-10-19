# Current Task — Session Handoff

> **Read this file FIRST, before anything else — even before `AGENT_START_HERE.md`.** This file is updated continuously *during* work. If the laptop shuts off or a fresh session starts with zero memory, reading this file must be enough to resume exactly where the last session stopped.

## STATUS: LAYER 2 COMPLETE — no work in progress

**Full evidence and findings: `docs/testing/LAYER2_REPORT.md`.**
**Verdict: GO** for demo/portfolio use. **CONDITIONAL** for real payments until `PLATFORM_GSTIN` / `PLATFORM_STATE` are set on Render.

Latest commits (both pushed, both re-verified live):
- `da61f67` — API answers unmatched routes with the JSON envelope (BUGSFIX 81)
- `bb3f7f5` — web hardening headers in `next.config.js`
- Layer 1 remains complete and tagged `layer-1-complete` at `ce2f391`

## What Layer 2 actually found

The deployment was **not** in the state Layer 1 left off in. Four blockers, all found by inspecting the live database rather than trusting the dashboards:

1. **Demo password hashes were never rotated.** `DEMO_PASSWORD` was set on Render, but that only affects seed scripts — login compares the stored bcrypt hash. Every demo login was 401. Fixed by running the real rotation entry point (see commands below).
2. **Ramakrishna School did not exist in production.** All 8 of its logins were 401; production was seeded before the second school shipped.
3. **LIBRARIAN + TRANSPORT_MANAGER logins missing** — seeded per school in a later commit than production's last seed.
4. **Production was 4 migrations behind.** The missing `subscription_invoices.plan` column is written by current code, so subscription invoice issuance was failing live. Two unique indexes were also missing (no DB backstop against duplicate fee invoices / double-booked teachers).

Plus 11 junk schools (e2e leftovers pointed at the live DB), 9 orphaned `school_id IS NULL` accounts, and heavy SOS demo pollution (113 stale PENDING payment intents, 4 test students, 9 junk fee structures). All remediated — production is now **2 schools, both `isDemo`, owner the only platform account, 45/45 migrations**.

## Results

| Area | Result |
|---|---|
| Login matrix | 16/16 demo accounts across both schools |
| Tenant isolation | 5/5 roles → `403 TENANT_MISMATCH` on foreign schools |
| Row scope | PARENT sees 1 child, STUDENT sees self, TEACHER section-scoped to 4 |
| Session/cookie/refresh/logout | 18/18 |
| Plan gating (PREMIUM vs STANDARD) | 11/11 |
| Concurrency | 20/20 at 200, p50 1.84 s |
| Cold start | **~23 s** (Render free tier spin-up) — main demo weakness |

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

## Local test environment note

`apps/api/.env` points at `127.0.0.1:3307` (a Docker MySQL that is not running). The installed MySQL80 service is on `3306` with an unknown root password. So `npm run test --workspace=@studyfy/api` currently fails at DB setup. The 404 regression test is pure (no DB) and was verified with a standalone `tsx` + supertest script; it will run in CI, which provides a fresh `studyfy_test` database.

## Cleanup state

Done: all temporary credential/token files deleted, both Layer 2 test schools and e2e leftovers removed, probe documents deleted, stray payment intents and test students removed. `secret.md` is gitignored and was never in any commit. No secrets appear in the report.
