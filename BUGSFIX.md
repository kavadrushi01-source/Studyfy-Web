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
37. **Stored certificate artifacts + print pages (2026-10-03, founder
    direction).** Certificates now persist: at issue the PDF uploads to
    storage and a documents row (type CERTIFICATE, pupil-owned) backs the
    record; downloads serve the stored bytes after a %PDF- check, falling
    back to snapshot regeneration (which also covers local dev without
    Cloudinary). Added GET detail for a new print page mirroring the
    ID-card pattern (no-print chrome + window.print), linked from the log.
    Pinned by tests (stored-bytes identity via data-URL stub, fallback,
    detail gates). Verified: API 213/213, e2e 57/57, print page
    human-checked.
38. **Confirm-before-generate on certificates (2026-10-03, founder ask).**
    Issuing fired straight from the selects; now pick pupil + type →
    Review details shows a confirm card (pupil, class, admission no.,
    numbering note) → Confirm & generate PDF (Back cancels; changing
    either select resets the step). E2E pins the card + generation.
36. **Convert to Admission (2026-10-02, founder ask, new micro-feature).**
    ADMITTED enquiries grow a "Convert to Admission" link into
    /students/new with the contact pre-filled as guardian (never as the
    pupil — the enquiry names the contact, not the child) plus a banner;
    successful admission writes "Admitted as X." back onto the enquiry
    timeline, closing the loop. Human-proven end to end; e2e pins guardian
    prefill + blank pupil.
39. **Chunk 3 build notes (2026-10-03, not bugs — first implementation).**
    Library (§7 #13): books + book_loans tables, library.read/manage keys
    (LIBRARIAN role mapped), issue/return transactions on availableCopies,
    derived OVERDUE, guarded shrink/remove. Debugging honors: (1) a mangled
    page file (duplicated function + swallowed handler header from stacked
    edits) — read the actual file, don't trust the edit preview; (2) an
    e2e anchored regex (`/^pupil$/i`) matched ZERO elements because the
    accessible name is "Issue to pupil" — a zero-match locator times out
    exactly like missing data, so count matches first when a lookup that
    "should" work never resolves; (3) Prisma create needs explicit
    schoolId despite the tenant extension stamping it at runtime, and
    exactOptionalPropertyTypes rejects explicit undefined. Verified: API
    216/216, e2e 59/59 zero flakes, human desk journey + screenshot.
58. **Subset timetable regeneration double-booked teachers (2026-10-09,
    human pass — REAL BUG, the serious kind).** Arjun Mehta taught 9-A and
    9-B simultaneously at Monday periods 2+3. Root cause: regenerating a
    SUBSET of sections wiped+replaced only those sections' slots, while the
    coloring lib only avoided collisions inside the demand set — existing
    rows in out-of-scope sections were invisible to it. Manual slot adds
    were already correct (section-free + teacher-free + qualification
    checks); only the generate path was blind. Fix: the service feeds
    surviving out-of-scope teacher occupancy into the lib as
    `blockedTeacherSlots`; displaced lessons surface as unresolved instead
    of colliding. Regression test regenerates one section around another's
    held slot and asserts placement aside + no teacher double-book.
    Cleaned the 2 clashing 9-A rows from the e2e DB (9-B's kept; next
    9-A regeneration heals itself). Verified: timetable suites green.
57. **Seed-row e2e asserts rot as test rows accumulate (2026-10-08, PWA
    pass).** Two specs asserted the SEEDED "Parent-Teacher Meeting on
    Saturday" notice is visible — but GET /notices serves the latest 100
    rows newest-first, and ~137 accumulated e2e rows had pushed the seed
    row out of the window (row present in DB, correctly excluded from
    the capped list). Not a product bug and NOT the service worker
    (fresh contexts start with empty SW caches; the failure screenshot
    showed live test data). Same class as BUGSFIX 45: e2e must be
    count-independent. Fix: both specs now publish a fresh stamped
    SCHOOL notice over the API and assert that. Standing rule extended:
    never assert ancient seed content on a capped newest-first list.
56. **Stuck-PENDING online payments (2026-10-06, founder-hit live).**

    Founder paid twice on prod; both invoices stayed PENDING. Root cause
    class: our UI relied SOLELY on the Razorpay webhook to flip the
    invoice — a lost/misconfigured webhook strands the payment with no
    recovery. Fix: `POST /fees/pay-verify {orderId}` reconciles OUR
    pending order against what Razorpay holds and applies captures
    through the SAME idempotent, amount-checked path as the webhook
    (parent-own-child + office only; unknown order 404; nothing held
    → PENDING, never an error). UI: auto-poll after checkout success
    (12×5s) + a "Check now" button while an order is pending. Proves
    the class, not just the incident: mocked-gateway tests (capture
    applies + idempotent redelivery, PENDING passthrough, stranger/
    pupil/unknown refusals). Verified: fees-verify 3/3, online-pay e2e
    incl. Check-now pin. Founder action still open: confirm the
    Razorpay dashboard webhook (URL + secret vs Render env) so
    webhooks flow again — verify covers future losses either way.
55. **Full-product pass (2026-10-06, founder-ordered, Phase 0–2).**
    Security matrix first (new permanent `security-matrix.test.ts`: fresh
    A/B schools, 13 cross-tenant URLs → TENANT_MISMATCH, scoped-ID 404s,
    owner cross-school reads + school-role/anon denials, student/parent/
    staff pins + unfiltered-default checks): the only red was my own test
    expecting 404 where the established contract is 403 — app correct.
    Module walks with real arithmetic: admit → temp-password first login;
    attendance 4/4-100% + 0/1-0% (seed + live marks compose correctly);
    counter 1400+25=1425 PARTIAL + 400 on overpay; ranks 1,2,2,4 with
    tie-skip; timetable generated 12 slots zero clashes school-wide;
    homework post→submit→grade; section notice reaches pupil, RK sees
    zero; Arjun→Aditya delivered, cross-school send 404; dashboards
    honest per school (SOS live activity, RK untouched). UI: teachers
    `!ready` blank paint → skeletons; attendance no-section blank →
    EmptyState prompt; dashboards' 480px loading splash kept (deliberate,
    shell-less context). Audit: source-map-js HIGH fixed via plain
    `npm audit fix` (devtool-only DoS surface) — **0 vulnerabilities**.
    Verified: API 62/62 files 237/237, e2e 65/65 zero flakes. No product
    bugs found in any module.
54. **UI consistency pass, Phase 2 screens (2026-10-05, founder-ordered).**
    Subagent audit vs theme.ts + Phase 1 idioms; fixed: (1) 23 section
    headers using weight-800 `h1Style` at 18/15px → `h2Style` (16/700,
    margins preserved) across crm/certificates/library/transport/payroll;
    (2) non-token `#F8FAFD` wells → `colors.lineSoft` (crm, certificates);
    (3) two-button rows → `sf-row-wrap` (certificates, library edit);
    (4) library loans board → `DataTable` (status pills, fine column,
    Return action, built-in pager/skeleton/empty — replaces hand-rolled
    pager + plain-text empty); (5) payroll status pills via `pill()` +
    skeleton gates on all six boards (office + self); (6) fees/payments
    blank `!ready` paint → skeletons, bespoke signed-out frame →
    `pageFrame`, always-mount `DataTable`; (7) receipts viewer frame →
    `pageFrame`. Deliberate keeps: print-artifact pages, small `<ul>`
    boards (transport/payroll month lists), header Lucide icons.
    Verified: tsc + eslint clean, e2e 65/65, screenshots reviewed.
53. **CI e2e job was dead on arrival (2026-10-05, founder asked "confirm
    CI is green").** The job ran `playwright test` with no DB, no
    migrate/seed, and no servers — warm-up died in 20s on every push, so
    CI was red under every commit. Root causes fixed together: (1) real
    lint errors the local `eslint src` never saw — unused `labelStyle`
    import + an `eslint-disable` for an unloaded react-hooks rule (CI
    runs `eslint .`; loaders now take explicit params via useCallback,
    no disable comment); (2) the deferred next 16.3.5→16.3.8 bump for
    the next/og RCE (audit 0 now); (3) the e2e job now wires MySQL +
    migrate + seed + both servers (NEXT_PUBLIC_API_URL baked at build,
    relaxed limiter knobs — one runner IP burns the 10/hour defaults).
    Verification of the fix IS the CI run itself.
52. **Close-out regression discipline (2026-10-04, Phase 2).** Two
    infra flakes, both load contention, neither product code: (1) a
    30s dashboard-aggregate timeout and (2) a native worker crash
    (exit 3221226505, the documented Prisma-on-Windows death) — each
    passed clean on re-run. Standing rule earned: STOP the dev servers
    before the API suite (zero contention → 61/61, 231/231 first try);
    restart with the FULL recipe knobs before e2e (limiter defaults
    fail public.spec after repeated runs). Close-out greens: tsc×3 +
    lint 0, audit 1 known-critical (next/og, never imported, bump
    deferred), API 231/231, e2e 65/65 zero flakes.
51. **Salary slip PDFs (2026-10-04, founder ask).** `lib/salary-slip.ts`
    (PDFKit, same setup as receipts — `Rs.` not `₹`: WinAnsi Helvetica
    has no rupee glyph) + `GET /payroll/:id/slip` (frozen row + live
    unpaid-day detail; staff narrowed to own via staffSelfScope, office
    reads any; 404 unknown). Slip buttons on office rows + My pay (blob
    → new tab). E2E byte-proofs real `%PDF-` via the request fixture.
    Lessons: (1) the running API serves `dist/` — a new route 404s until
    rebuild+restart (same trap as the webhook, now twice-bitten);
    (2) long two-login tests get `test.setTimeout(90000)` under parallel
    load; (3) API restarts must carry the full recipe knobs or repeated
    full runs exhaust the 10/hour enquiry limiter and fail public.spec.
    Verified: API 231/231, e2e 65/65.
50. **StaffSelfScope middleware (2026-10-04, founder-ordered, test-first).**
    Payroll had staff self-pinning re-derived per handler (role checks +
    userId lookups in every list fn). Now `staffSelfScope` in selfscope.ts
    mirrors the §3 student shape: office (School Admin/Accountant) passes
    unconstrained; everyone else pins to [ownStaffId] from the login, no
    staff row → 403, explicit other-id in params/query/body → 403.
    Handlers take `allowedIds: string[] | null` (null = office) and an
    empty array fail-closes to nothing — `[]` is truthy in JS, so the
    length check is the actual guard, not the `if`. Discipline kept:
    regression test written first (RED: `staffSelfScope is not a
    function`), endpoint contract (teacher ?staffId=other → 403, default
    → own) guards the refactor. Verified: API 230/230, e2e 65/65.
49. **Payroll founder-schema rebuild (2026-10-04, founder-directed).**
    Replaced SalaryStructure/PayrollPayment with exactly staff_attendance
    (staff+date UNIQUE, re-mark overwrites, AttendanceStatus reused),
    leave_requests (dates JSON array, PENDING→APPROVED/REJECTED once),
    payroll (staff+month UNIQUE, base/deductions/net Decimal-exact).
    Retired with the old tables: salary structures, month-generate, and
    the PENDING→PAID mark-paid flow (the founder schema carries no paid
    status). Deduction policy (no spec formula — disclosed office rule):
    base/30 per day × (ABSENT days minus APPROVED-leave-covered days);
    approved leave never deducts; recompute replaces the row. Leave
    filing: staffId omitted → resolved from the login (office passes
    explicit ids). E2E lesson: hidden `<option>` elements match getByText,
    so `.first()` can land on an invisible node — assert on phrasing
    unique to the visible row. Verified: API 226/226, e2e 65/65.
48. **Transport founder-schema rebuild (2026-10-04, founder-directed).**
    Replaced BusRoute/BusStop/BusVehicle/StudentTransport with exactly
    vehicles (registration_number UNIQUE per school, capacity, driver_name),
    transport_routes (name, stops JSON run), student_routes (student+route
    join, one active ride). Retired with the old tables: route
    descriptions, driver phones, vehicle→route links, per-stop boarding
    (riders are route-level now; stop-remove needs no guard, route-remove
    keeps the riders guard). Stops are index-addressed
    (`routes/:id/stops/:index`, 0-based; out-of-range 404s). Migration
    carries rows (GROUP_CONCAT+JSON_OBJECT ordered into the JSON run;
    session concat cap raised) — verified byte-identical runs locally.
    assignRider survives the find-then-create race via a P2002 fallback to
    update. Verified: API 224/224, e2e 65/65, screenshot-reviewed.
47. **Duplicate sidebar links (2026-10-04, founder-found on prod).**
    Chunk 4 pasted Transport/Payroll into the admin nav twice and Payroll
    into the accountant nav twice — two identical links + React key
    collision. The sidebar sweep now asserts label uniqueness per role
    (strips the "Soon" pill text first), which fails 19-vs-17 on the old
    build and passes on the fixed one.
43. **Chunk 4 build traps (2026-10-04, Transport + HR/Payroll).**
    (1) Prisma `upsert` where-clauses cannot carry the tenant `schoolId`
    (tenant extension owns it) — replaced with update-or-create inside the
    tenant context; (2) stop renumbering must stay dense after deletes
    (P2002 retry on reorder); (3) new tenant models MUST join
    `TENANT_MODELS` + permission-keys migration or prod 403s (same trap as
    Chunk 3's missing-keys outage). Verified: API 220/220, e2e 65/65.
44. **Library last-write-wins race (2026-10-04, real app bug found by the
    suite).** Mount-effect `loadLoans` and post-save `loadLoans` overlap;
    under parallel-suite load the stale pre-save response resolved last
    and repainted `Current: ₹5/day` after a ₹7 save (fine-rate test flaked
    2 full runs, passed retry). Both loaders now carry monotonically
    increasing request ids — only the newest response may paint. Lesson:
    a test that fails-first-then-passes-retry on a 20s-polling assertion
    is a stale-overwrite race, not timing — fix the loader, not the test.
45. **E2E count-independence (2026-10-04).** Two tests assumed dataset
    shape: library edit/add expected the new title on catalog page 1
    (title-A–Z paging pushed it to page 2 after 28 accumulated E2E books),
    roster expected Next enabled (exactly 10 pupils = 1 page). Both now
    search/navigate first and assert pager state conditionally. Rule: no
    e2e assertion may depend on accumulated row counts.
46. **Restart env (2026-10-04, cost an hour).** After a process kill the
    API came back WITHOUT `FRONTEND_ORIGIN` (browser login died with CORS
    preflight ERR_FAILED while direct API login 200'd — split proven via
    temp `request` vs `page` spec) and the web served a build baked WITHOUT
    `NEXT_PUBLIC_API_URL` (`:4000` default vs API `:4001`). Recovery order:
    MySQL 3307 → API (`PORT=4001` + `FRONTEND_ORIGIN`, cwd `apps/api` for
    dotenv) → web (`next start --port 3001` via root `.bin` shim, cwd
    `apps/web`). Standing rule: after ANY kill, re-read the CURRENT_TASK
    start recipe before assuming servers are healthy.
42. **Senior review of Chunk 3 (2026-10-03, founder-ordered).** Read
    every line fresh; found and fixed: (1) REAL issue/return race —
    check-then-act outside the transaction let two desks issue the last
    copy twice (count to -1) and double-return increment twice; both
    paths now use conditional guarded updates inside transactions,
    pinned by concurrent-desk tests (5× issue → exactly one 201,
    5× return → exactly one 200); (2) updateBook read-modify-write moved
    into a re-checking transaction; (3) corrupt school timezone strings
    could NaN every fine — schoolDay falls back safely; (4) UX: desk book
    search (catalog pagination hid titles), remove confirmation (history
    deletes with the title), loans pager (>50 hidden before), edit panel
    auto-close, add-book filter reset. Test-script honors, not app bugs:
    anchored regexes matching zero elements, self-matching success text,
    dialog deadlocks from awaiting clicks before handlers. Verified:
    API 220/220, e2e 61/61, typecheck+lint 0, human passes + screenshots.
42. **School-timezone fines (2026-10-03, founder cites §12.7).** Overdue
    math ran on UTC day boundaries — a book due 23:30 UTC is due 05:00
    IST next morning, and UTC counted a day IST never saw. Now
    calendar-day diffs in the school's own timezone (DST-immune), applied
    to status, live fines, and the OVERDUE filter together (a UTC SQL
    pre-filter would have disagreed with display around midnight — the
    filter now narrows the bounded open set in code). Pinned by unit
    tests that UTC and IST answer differently on the same instants.
    Verified: library 6/6, e2e library 4/4, live issue/return clean.
41. **Catalog edit UI (2026-10-03, founder ask — the one CRUD piece with
    API but no screen).** Add/remove/counts already shipped; per-row Edit
    now opens a prefilled panel (title/author/ISBN/category/copies) with
    server guards surfaced (shrink-below-issued refused with the count).
    Librarian desk proven by API test (add→edit→issue→return). Verified:
    library e2e 4/4, human edit pass + screenshot.
40. **Library fines (2026-10-03, founder picked option A).** Flat ₹/day
    per school (`schools.library_fine_per_day`, default 5) + `fine_amount`
    frozen on loans at return; open loans price live, history never
    rewrites. New GET/PATCH settings endpoints, fine on every loan row,
    admin settings block + desk rate note. Debugging honors: (1) ceil day
    boundaries need margin in tests (3 days + ε = 4 — backdate 2.5);
    (2) missing Content-Type on hand-written POSTs 400s (same trap as the
    timetable build — now a standing check). Verified: API 217/217, e2e
    60/60, human settings journey + screenshot.

59. **Unpinned tenant-root read returned a stranger school's row (2026-10-11,
    caught by test — the serious kind).** The new billing overview did
    `req.prisma.school.findFirst({})` with no `where`, trusting the tenant
    extension to pin it. But `School` is deliberately NOT in `TENANT_MODELS`
    (it has no `schoolId` column — it IS the root), so the extension never
    touches `school.*` queries: the endpoint served the FIRST school row in
    the table (an old "Dashboard School" fixture) to a logged-in admin of a
    different school — same shape as v1's leak class, milder data (mirror
    fields, not pupil records). Every other school read in src/ passes an
    explicit id/slug (verified by grep — this was the only bare one). Fix:
    explicit `where: { id: req.schoolId }` + a regression test asserting
    `data.school.id` equals the caller's school. Standing rule earned:
    NEVER read the schools table without an explicit constraint, extension
    or not — the root is outside the extension's protection by construction.
    Companion lesson from the same session: inside a router mounted at
    /api/v1, Express strips the mount prefix, so req.path is "/schools/…"
    — URL maps anchored on /api/v1 silently match nothing (that one shipped
    the whole plan gate open; fixed with mount-agnostic regexes + a
    path-shape regression test).

60. **Support-console selects collapsed to chevron-only (2026-10-14,
    caught by screenshot review, not by tests).** The four priority/status
    `<select>`s on `/support` + `/owner/support` carried inline
    `style={{ flex: 0 }}` (`flex: 0 1 0%`) against the `.sf-input` class
    (`display: block; width: 100%`): flex-basis 0% won and every select
    rendered ~30px wide showing only its chevron — "All priorities" etc.
    invisible. E2e visibility asserts could not see it (options exist in
    the DOM either way). Fix: `flex: "0 0 auto"` alone swung too far the
    other way (full-row width, proven by second screenshot), so the final
    shape is `flex: "0 0 auto"` + `width: "auto"` — compact, content-sized.
    Regression: owner-console e2e pins the filter's bounding box width >
    80px. Standing rule earned: visibility ≠ paint — screenshot review
    catches layout bugs the suite cannot (same lesson as the sidebar
    stretch, #25fb8fe).

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
