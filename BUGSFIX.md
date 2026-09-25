# Studyfy Bug & Fix Guide — Rebuild Edition

This file records bugs found during the rebuild, their root cause, and the
fix. It's seeded below with the real bugs found during the v1 build attempt
— not because they've happened again, but because they're the specific
mistakes most likely to recur if you're not watching for them. Read this
before debugging, and add new entries as they're found (per RULES.md §9).

## Required Validation
Run from the repo root after relevant changes:
```bash
npm run build:api
npm run build:web
npm run lint
npm run test --workspace=@studyfy/api
npm run test:e2e --workspace=@studyfy/web
npm audit --audit-level=high
```

## Seeded Entries — Known Pitfalls From v1 (watch for these specifically)

1. **Route declared after `export default router` is dead code.** Happened
   to the exam export route in v1. Declare all routes before the export;
   add a lint rule or code-review check if your tooling supports it.
2. **A router mounted twice can expose admin endpoints publicly.** v1's
   enquiry router had a duplicate public mount. Mount each router exactly
   once; test every admin endpoint unauthenticated and expect 401/403.
3. **Tenant-scoping list missing newly-added models.** v1 added 11 Prisma
   models without adding them to the tenant-scoping list. See
   `SECURITY_PATTERNS.md` §1 — add new tenant-scoped models to
   `TENANT_MODELS` in the same commit as the schema change.
4. **A "verify" endpoint that matches a token but never persists the
   result.** v1's `verifyEmail` matched tokens correctly and then did
   nothing with the result — the user's `emailVerified` field never
   changed. Any confirm/verify flow needs a test asserting the DB actually
   changed, not just that the endpoint returned 200.
5. **Password reset / verification tokens stored in an in-memory `Map`.**
   Lost on every restart or redeploy. Use a DB-backed table (`auth_tokens`)
   from the first commit.
6. **Socket.io stale closure.** A "current peer/recipient" captured in a
   plain variable inside a component doesn't update across re-renders in
   React — real-time messages stop refreshing. Hold it in a ref (or your
   framework's persistent-reference equivalent).
7. **Missing route guard on a platform-admin page.** Any logged-in user
   could reach it. Every Platform Owner route needs an explicit role check,
   not just "is authenticated."
8. **A DataTable component that claims sort/pagination support but doesn't
   implement either.** Implement it, or don't advertise it in the UI —
   this is exactly the kind of "looks done, isn't" gap the Definition of
   Done in `STATUS.md` is meant to catch.
9. **Row-level scoping missing on fee invoice detail/receipt/payment
   endpoints.** A `findFirst`/`findUnique` by ID alone, without also
   filtering by `schoolId`, lets one school fetch another's invoice by
   guessing/incrementing an ID. Every single-record lookup needs the
   tenant filter, not just list endpoints.
10. **Pages crashing on a failed "fetch current user" call.** Null-check
    session/user data before rendering; a failed auth check should redirect
    to login, not throw.
11. **Prisma `Decimal` fields arrive as strings over JSON.** `total += invoice.amount`
    concatenates instead of adding. Coerce with `Number(...)` (or a proper
    decimal library) before any arithmetic on a `Decimal` field.
12. **The single most serious one: Student/Parent roles could read ANY
    student's profile, attendance, marks, fee invoices, and library history**
    via broad `*_READ` permissions with no row-level check underneath them.
    This is exactly what `SECURITY_PATTERNS.md` §3 exists to prevent
    structurally, with the regression tests in §4 written before the
    feature modules that expose the data, not after.

## Found During Rebuild (new entries — newest last)

13. **Socket.io emit from the root server never reaches namespace rooms
    (2026-09-22).** `emitToSchool` called `io.to(room).emit(...)` on the
    root server, but every client joins its room inside its own
    `/school-<id>` namespace — rooms are per-namespace, so the event landed
    in a same-named room in `/` that nobody joins. `message:new` was
    silently lost in production while HTTP threads looked correct. Caught by
    adding the missing live-delivery test (`message-realtime.test.ts`: join
    over socket → send over HTTP → assert the event arrives). Fix: emit via
    the dynamic `/school-*` namespace object. Lesson: every socket emit
    needs a test asserting arrival on a real client, not just server-side
    "emit was called."
14. **Parallel test workers raced global seeding → CI-only P2002/P2034
    (2026-09-22).** Every vitest worker's setup called `seedRoles` /
    `seedPermissions`; Prisma `upsert()` is SELECT-then-INSERT (not atomic),
    so workers INSERTed the same key (`roles_name_key`,
    `permissions_key_key` — CI runs 35725384214, 35611906623) while local
    runs stayed green by timing luck. Replaced with single-statement
    `createMany({ skipDuplicates: true })` (atomic INSERT IGNORE) +
    idempotent `updateMany`, wrapped in a retry that ONLY catches P2002
    (lost insert race) and P2034 (deadlock) — both writers set identical
    constant values, so retries always converge; all other errors throw
    immediately. Regression: `seed-concurrency.test.ts`, including a
    deterministic worst case (delete LIBRARIAN — held by no test user,
    referenced by no mapping — then 20 parallel seeders, which kills old
     code with P2002 on demand).
16. **Web `"error" in body` check vs the API's nullable envelope
    (2026-09-24).** Every API response carries `error: null` on success,
    so `"error" in body` is true on EVERY call — login and all 19
    data-fetching pages crashed with "Cannot read properties of null
    (reading 'message')" exactly when things worked. It survived because
    curl-level checks read fields directly, API tests assert truthiness,
    and tsc accepts `in`-narrowing as valid. Fix: shared `isFailure()`
    type guard in `apps/web/lib/api.ts` (value check + narrowing
    preserved), applied mechanically to all 19 files (84-line diff).
    Regression: web typecheck + build (no web unit harness exists);
    rule — never `in`-check an API body, always `isFailure()`.
17. **Login limiter blocked legitimate hand-testing (2026-09-24).** 5/15min
    is correct for production (§11) but makes trying 6+ demo roles
    impossible — the founder hit the wall mid-session. Fix keeps default 5
    everywhere (CI/prod untouched) with a `LOGIN_RATE_LIMIT_MAX` override
    for the gitignored local `.env` only (currently 200), documented in
    `.env.example` as never-for-production. Deliberate exception, not drift.
15. **Workspace lint passing while CI lint failed (2026-09-23).**
    `npm run lint --workspace=@studyfy/api` lints `src` only; CI's root
    `npm run lint` lints everything including `tests/` — an unused variable
    in `teacher-dashboard.test.ts` stayed green locally through four
    dashboard builds and failed CI on three straight commits (CI runs
    35850912329, 35859552876, 35864982904). Rule from here on: the
    pre-commit gate is ROOT `npm run lint`, never the workspace shortcut.
    (No regression test applies — process rule, recorded here so it sticks.)

18. **Teacher pending count froze after pupil submits (2026-09-24).**
    Post + grade invalidated the teacher board cache but submit did not —
    the count lagged up to the 60s TTL, looking exactly like "submitting
    does nothing" (live: stale 6 vs real 7). One-line root-cause fix in
    `submitHomework` + regression test (prime → submit via HTTP →
    pending +1). Companion finding, not a bug: file submit 503s without
    Cloudinary creds (`STORAGE_UNCONFIGURED` — needs free-tier keys in
    dev `.env` to test uploads); text path fully green.
19. **Students/parents could not open fee receipts at all (2026-09-24).**
    The receipt route required `fees.manage` (staff-only) — found in the
    full verification pass while checking every role can use what the UI
    offers. Widened to `fees.read` + ownership pin check (same shape as
    the ledger), proven live (own 200 PDF, stranger 403, cross-tenant
    404) + regression test. Teachers still 403 (hold neither key).
20b. **Forms asking humans for database IDs (2026-09-24).** Homework post
    took raw text as `subjectId`, so typed names 404'd — same trap class
    as slug-vs-ID. Rule: every ID field gets a name dropdown backed by a
    tenant-scoped list endpoint (added `GET /subjects` here); raw-ID text
    inputs are a bug, not simplicity.
20. **Full suite flakes when dev servers run alongside it (2026-09-24).**
    A 3-file failure run went fully green on immediate re-run — the only
    difference was the API + web dev servers competing for CPU/MySQL.
    Rule: stop dev servers before a verification suite run, or treat a
    lone red run as suspect until one clean re-run.
21. **Grade-by-typing-a-submission-ID (2026-09-24).** The homework grade
    box needed an ID no screen ever displayed — grading through the UI
    was effectively impossible. Teacher board rows now carry pending
    submission ids + names (students get null — no leak), and the box is
    per-submission Grade buttons. Regression test asserts both sides.

## Debugging Rules
- Reproduce the failure with the narrowest test or endpoint first.
- Check API logs and the network response before changing UI selectors.
- Preserve tenant filters on every query; verify cross-tenant behavior
  explicitly, don't assume the extension in `SECURITY_PATTERNS.md` covers a
  path you added it to after the fact.
- Fix the root cause before weakening a test assertion.
- Add a focused regression test for every reproducible bug — that test is
  what keeps it fixed.
- Update `STATUS.md` when a tracked gap's state changes.
