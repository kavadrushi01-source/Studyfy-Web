# Start Here — Studyfy, Fresh Build

This is a from-scratch build. No prior codebase exists or is being reused.
You may be running on a different free OpenCode model than the last
session — that's expected and fine, as long as you follow the read order
below every time.

Read these in this order, every session:

1. **`CURRENT_TASK.md`** — read this *before even this file's checklist
   below*. If it says `Status: IN PROGRESS`, there's interrupted work —
   resume from its "Exact next action," don't restart or re-plan. If
   `Status: IDLE`, continue to step 2.
2. **This file** — orientation, step 0, and the Phase 0 checklist below.
3. **`STUDYFY_PROJECT_SPEC.md`** — what to build.
4. **`RULES.md`** — how to work, including §11's session-continuity rules
   (update `CURRENT_TASK.md` continuously while working, not just at the end).
5. **`docs/designs/*.png`** — open and look at these before building any
   screen (if the active model takes image input — Muse Spark 1.3 does; if
   a fallback model doesn't, spec §8.2–8.4's written description stands on
   its own). Skip the three things spec §8.1 / `RULES.md` §5 say to skip
   (login role tabs, fake trust stats, app-store badges).
6. **`SECURITY_PATTERNS.md`** — adapt (don't blindly trust — see Step 0
   below) before writing your first tenant-scoped query.
7. **`DEMO_DATA.md`** — the exact two schools/rosters to seed (§7's
   "Demo Data" section) — use these names, don't invent different ones.
8. **`STATUS.md`** / **`BUGSFIX.md`** — current state and pitfall log.

## Why some of this reads like it's citing bugs that already happened
A prior attempt at this exact project (different codebase, now deleted) hit
a critical bug where any student could read any other student's data, plus
several other issues logged in `BUGSFIX.md`. None of that code is here or
being reused — only the lessons are. Where a rule looks oddly specific,
that's why.

## Step 0 — before you trust any reference file, verify it
`SECURITY_PATTERNS.md` and `.github/workflows/ci.yml` are **patterns to
adapt, not drop-in code** — they haven't been run against your actual repo.
Before relying on either:
- [ ] Type-check `SECURITY_PATTERNS.md`'s code against your actual Prisma
      schema and Express app structure. Fix any mismatches.
- [ ] Confirm `.github/workflows/ci.yml`'s script names
      (`npm run lint`, `npm run typecheck`, `npm run test`, etc.) actually
      match what's in your `package.json` — adjust the workflow file if not.
- [ ] Only once both compile/run cleanly against your real code, treat them
      as part of your working setup.

## Phase 0 checklist — do this first, in order, before any feature module
_(Remember: set `CURRENT_TASK.md` to `IN PROGRESS` before starting any box
below, and check items off there as you go — not just here.)_

- [ ] Step 0 above, done.
- [ ] Scaffold the monorepo per spec §19.
- [ ] `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`,
      both workspaces.
- [ ] Prisma schema — **the full core schema from spec §9.1, in one pass,
      not just the identity tables.** The seed script (a few boxes down)
      needs `classes`, `sections`, `students`, `student_guardians`,
      `staff`, `attendance`, `fee_structures`/`fee_invoices`/
      `fee_payments`, `exams`/`exam_subjects`/`marks`, `homework`/
      `homework_submissions`, and `notices` to already exist — build the
      whole thing now, don't stop at `schools`/`users`/`auth_tokens` and
      discover the gap when the seed script won't run. Specifically:
      `schools` (with `timezone`, and `subscriptionStatus`/`trialEndsAt` —
      every registration defaults to `TRIAL`; §13.4's gate needs this from
      Phase 0 even though the full billing UI is Phase 4), `users`
      (nullable `school_id` — NULL
      means Platform Owner), `roles`/`permissions`/`role_permissions`
      (**global tables, not tenant-scoped** — seed the fixed role set
      once, see §9.1's fifth note), `subjects` (seeded from spec §3),
      `auth_tokens` (DB-backed, single-use), plus every table listed above.
      `messages`, `documents`, and `audit_logs` can genuinely wait for the
      phases that use them.
- [ ] Auth: register/login/refresh — login takes email + password + an
      *optional* school slug (omitted = Platform Owner, spec §8.3). bcrypt
      cost ≥ 10, JWT access(15m)+refresh(7d) as httpOnly cookie.
- [ ] Tenant middleware + Prisma tenant-scoping extension
      (`SECURITY_PATTERNS.md` §1). Write the cross-tenant regression test
      **before** the middleware passes it.
- [ ] **Separate `platformOnlyMiddleware` for the Platform Owner**
      (`SECURITY_PATTERNS.md` §2) — don't try to force this role through
      `tenantMiddleware`, it will not work.
- [ ] RBAC middleware + Student/Parent row-level self-scope
      (`SECURITY_PATTERNS.md` §3). Same rule: test first.
- [ ] Seed script (`prisma/seed.ts`) — **two** fully-populated demo schools
      (School of Science and Ramakrishna School — exact roster in
      `DEMO_DATA.md`), each with a full role roster and sample data. Run it
      now, use it for every screen you build after this.
- [ ] `helmet`, CORS lock, rate limiting on auth + public enquiry endpoints,
      `/health`, graceful shutdown.
- [ ] CI green: lint, typecheck, unit tests, `npm audit --audit-level=high`.
- [ ] Confirm the cost boundary is respected (spec §1) — no live
      SMS/WhatsApp key yet (that one stays deferred until told otherwise).
      Groq (AI) is fine to wire for real, free, when Phase 3 arrives.
      Razorpay is fine to build for real when Phase 2 arrives, but **TEST
      keys only, permanently** — never live keys, see spec §1/§13.8 — just
      not before Phase 0 is done.
- [ ] Only once every box above is checked and tested: move to spec §7
      Phase 1 (MVP feature modules) and spec §8 (UI, matched screen-by-screen
      against `docs/designs/`, minus the three exclusions).

Do not start Phase 1 feature modules or any dashboard screen before this
checklist is done and tested.
