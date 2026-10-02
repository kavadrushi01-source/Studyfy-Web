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
22. **Favicon and robots.txt 404'd (2026-09-26).** The web app had no
    `public/` directory at all — `/favicon.ico` and `/robots.txt` were
    dead (found by the every-route HTTP sweep). Added `app/icon.svg`,
    a generated `public/favicon.ico`, and `public/robots.txt`;
    the sweep now asserts 200 for all three plus every app route.
23. **Detail routes ignored their own URL param (2026-09-26).**
    `/students/[id]`, `/students/[id]/report`, `/students/[id]/id-card`
    and `/fees/receipts/[id]` rendered paste-an-ID forms — the path was
    decorative, so every deep link landed on a manual lookup dead end.
    All four now load their record from the route (report added an async
    exam dropdown; id-card keeps the school-name input because nothing
    placeholder-printable exists for it). Rule: a `[param]` in the path
    must drive the data load, or the route shouldn't exist.
24. **Receipt "popup blocked" false error (2026-09-26).** The receipt
    viewer opened the PDF with `window.open(url, "_blank", "noopener")`,
    which Chrome guarantees returns `null` — so a successful open
    reported "blocked by your browser". Same bug the report-card page
    already had fixed; adopted that fix (open normally, then sever
    `opener`) with a real blocked fallback message.
25. **Student roster was a dead end (2026-09-26).** Rows didn't link to
    the student profile, the profile had no path to report card / ID
    card, and "Admit student" lived only on the dashboard. Name cells now
    link to `/students/[id]`, the profile carries Report card / Print ID
    card actions, and the roster header has a "+ Admit student" CTA.
26. **Staff-only fetches and forms ran for every role (2026-09-26).**
    Route×role sweep: pupils/parents produced 403 console noise from
    `/sections` (exams results, timetable, notices) and `/subjects`
    (homework), and saw staff-only forms (post homework, grade, publish
    notice). Fetches are role-gated (`canEnter`/`canManage`/
    `canPublish`/board role), staff forms hide for non-staff, and the
    timetable only probes the full section list as admin/teacher —
    pupils go straight to their scoped endpoint. Sweep re-run after the
    fixes: 0 findings, 0 console errors across 26 routes × 6 roles.
27. **Reopened attendance day showed silent all-PRESENT defaults
    (2026-09-27).** The marking screen loaded only the roster and never
    fetched what had already been saved for that date - so reloading a
    marked day displayed every student as Present, and a careless re-save
    would have flipped real absences to present (silent data loss).
    Found in the deep human pass: added `GET
    /schools/:schoolId/attendance?date&sectionId` (same admin/class-teacher
    gate as marking, 2 API tests) and hydrated the screen from it - on
    section pick, Reload, and date change. Present/Absent pills also
    gained `aria-pressed` so state is assertable (and screen-reader
    legible) instead of style-only.
28. **Blank marks inputs were saved as zeros (2026-09-27).** Marks entry
    mapped every roster row through `Number(marks[id] ?? "")`, and
    `Number("")` is `0` - typing one student's score silently sent 0 for
    every untouched classmate, and re-entry overwrites server-side, so one
    casual save would have wiped the section's real marks. Only rows the
    teacher actually typed into are sent now; over-max scores are still
    refused server-side ("Marks cannot exceed the maximum of N"), pinned
    by the new e2e.
29. **Pupil submit boxes rendered for every role (2026-09-28).** The
    homework board's "Your answer" form + Submit button rendered under
    every assignment for teachers, admins, and parents - dead forms
    (their submit 403s server-side), confusing enough that a human tester
    tried to use one. Same leak class as BUGSFIX 26, mirrored direction:
    the submit block is now STUDENT-gated (post + grade were already
    staff-gated). Pinned by e2e (teacher board carries zero submit boxes;
    full teacher-post to pupil-submit loop green). Companion observations,
    unchanged by design: (a) the Subject dropdown lists every subject
    while posting is qualification-gated - the refusal ("Only a teacher
    of this subject and section may post its homework.") is correct
    server-side validation, not a bug; (b) the pupil board takes the 100
    earliest-due rows, so far-future fixtures hide below backlog - date
    e2e fixtures near-term.
30. **Three mobile-viewport overflows (2026-09-28).** A 390px sweep over
    every route and role found exactly three pages pushing past the
    viewport: (a) landing header (+253px) - center nav plus Login/Get
    Started block; fixed by collapsing center links at 760px or below
    (needed `!important` - the nav's inline `display:flex` beats any
    stylesheet rule); (b) dashboard cards with long rows (+9px) - grid
    children forcing their 1fr track wider; fixed with a global
    `min-width: 0` rule on grid children plus `min-width: 0` on the row
    content divs; (c) messages thread rows with long previews (+26px) -
    the threads list needed `minmax(0, 1fr)`. Re-sweep after the fixes:
    0px on all 30+ pages, header screenshot-verified. Debugging rules
    earned: when CSS "doesn't apply", suspect inline styles first; when
    a fix "doesn't take", verify which server build is actually serving
    (a stale process held port 3001 through two restarts here); hunt
    overflowing elements with bounding-rect measurements, not theory.
31. **Sidebar ate the whole phone screen (2026-09-28).** Past the overflow
    fixes, every dashboard still opened with the full navy menu (logo,
    badge, 12 links, logout) stacked above the content - usable but not
    phone-grade. The sidebar is now a collapsible top strip on narrow
    screens: logo + badge + hamburger, menu collapsed by default, content
    first. Caught mid-build by screenshot review: the collapse CSS did
    nothing at first because the nav/logout carry inline `display`
    styles - same inline-beats-stylesheet trap as BUGSFIX 30, same
    `!important` cure, now a standing rule (visibility always lives in
    classes, never inline). Pinned by e2e (collapsed-by-default,
    open-close, navigate).
32. **Pay Online offered to every role; homework post/grade offered to
    admins; message composer offered to admins; login lockout hit every
    account (2026-10-01, founder-found round).** Four role-scope complaints
    in one pass, all real: (1) the fees Pay button rendered for admins,
    accountants, teachers and pupils, and pay-order accepted staff/pupil
    calls — now PARENT-only in UI and API ("Only parents can pay online."),
    staff keep counter recording; (2) the homework post form + grade queue
    rendered for admins (`canManage` was TEACHER-or-ADMIN) — now
    TEACHER-only, admins keep the read-only board, e2e homework-post moved
    to the teacher circuit; (3) the messages composer rendered for admins
    whose sends can never succeed (oversight is read-only by §13.7) — now
    an oversight note replaces it; parent→child's-teacher messaging was
    verified working end to end (it was never broken — the denial in the
    screenshot was an admin send); (4) the per-IP login limiter burned one
    shared budget, so one browser's failures locked out innocent accounts
    — removed, the per-account limiter (5 failures/15min/email, successes
    never consume budget, logout unlimited) is now the only login guard.
    Pinned by updated API tests (parents-only pay-order, account limiter)
    plus e2e (admin read-only asserts, teacher post) — API 201/201, e2e
    51/51. Lesson earned twice this session: when a fix "doesn't take",
    check which server build is actually serving (a stale next-server held
    the old UI through a rebuild here), and when a checkout iframe has two
    same-named buttons, force-clicks land on the hidden one — click the
    dialog's own button with a real mouse click.
33. **Founder screenshot round: blind grading, paste-ID timetable, missing
    own IDs, bare names, nameless mark boxes (2026-10-02).** Six asks, five
    real defects: (1) the grade queue showed only names + Mark graded —
    the board API never sent the work, so teachers graded blind; pending
    rows now carry answer text + file link + submitted time (staff-only
    branch), rendered in the queue; (2) "My timetable" needed a pasted
    staff ID — `mine=true` resolves the teacher from the session,
    pupils/parents lost the dead lens, admins got a staff picker, plus an
    admin Build block (auto-generate per section with per-subject periods,
    manual slot, per-cell remove); (3) profile showed only the school's ID
    — `/auth/me` now returns role identity (admission no. + class, staff
    ID + designation, parent's children) with a My ID row for everyone;
    (4) threads showed bare names — rows now carry relationship labels
    ("Suresh Sharma · Aditya Sharma's father", teacher subjects, pupil
    section), batched, picker-consistent; (5) marks entry confused because
    boxes opened blank AND names never rendered — the roster nests names
    at `user.name` while the form read flat `s.name`, so production showed
    nameless boxes ("Marks for undefined"); fixed with flattening +
    prefill of saved marks via a new class-teacher-gated endpoint,
    explainer text, and 0–max placeholders. Caught-by-test honors: the
    prefill placeholder broke the old `getByPlaceholder("Marks")` lookup
    (now by accessible label), displayed-but-untyped generate defaults
    submitted as 0 until seeded into state, and missing Content-Type on
    the new generate/slot POSTs 400'd until added. Verified: API 205/205,
    e2e 51/51, 18-check human pass, screenshots reviewed.
34. **Founder follow-up round: unopenable homework PDF, false #1 ranks,
    sticky graded rows, uncapped uploads (2026-10-02).** Four asks: (1) a
    small homework PDF would not open ("Failed to load PDF document") —
    the upload path stores whatever bytes arrive, so a renamed/corrupt
    file becomes a permanently broken link; submissions now require true
    magic bytes (%PDF-, JPEG/PNG/WebP signatures) with a 415 that names
    the real problem, plus a Download fallback beside Open; the exact
    failing URL was already graded off every board (no pending fileUrl
    exists on prod), so if the founder's file still fails, its link is
    needed to check the Cloudinary side. (2) A parent saw his son ranked
    #1 falsely — the results query filtered takers by self-scope pins
    BEFORE ranking (against its own "whole-class ranks" docstring);
    ranks now compute over every taker and pins only filter display
    (human proof: scoped rank 8 = admin rank 8); report cards already
    ranked full-set and dashboards show no ranks, so the board was the
    only offender. (3) Graded homework "showed a second time" — the row
    now vanishes optimistically the instant Mark graded is clicked, the
    server reload confirms, a failed grade restores it with the error.
    (4) Uploads capped at 2 MB + one file (founder's DB-load ask), hint
    text on the submit box. Pinned by API tests (magic/size gates, true
    pinned rank) — API 207/207, e2e 51/51.
35. **Chunk 2 build notes (2026-10-02, not bugs — first implementation).**
    Admission CRM + Certificate generator (§7 #16/#17): new tables
    (enquiry_notes, certificates) + enquiry assignee/updatedAt via
    migration (updated_at backfilled from created_at for existing rows);
    four RBAC keys (crm.read/manage, certificates.read/manage) seeded AND
    shipped as an idempotent data migration so production (never seeded)
    gets them with `migrate deploy`; PDFKit refused byte-identical
    re-downloads (timestamps/IDs embedded — assert validity + size, not
    bytes); displayed-but-untyped form defaults and missing Content-Type
    on hand-written POSTs were the two UI traps, same as the timetable
    build. Verified: API 212/212, e2e 56/56, human pass (public→CONTACTED
    journey, TRANSFER CERT/2026/0003 with 2073 real PDF bytes).

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
