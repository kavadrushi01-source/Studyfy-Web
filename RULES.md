# STUDYFY — WORK RULES v3.2 (fresh build)

> **The single rule that overrides everything else:**
> **ALWAYS work strictly according to `STUDYFY_PROJECT_SPEC.md` (v3.2).** That
> file is the source of truth. If something contradicts the spec, follow the
> spec and note the deviation in §9 below.
>
> This is a from-scratch build. No prior codebase exists or is being reused.

## 0. Why These Rules Exist
An earlier attempt at this exact project reached a high self-reported
completion percentage while a critical bug let any student read any other
student's records, several dependency vulnerabilities sat unresolved, and
the UI never matched a locked design target until a late "visual pass." None
of that was a technology problem (spec §2 confirms the stack choice). It was
**sequencing**: security bolted on late, breadth built before depth. This
file makes the fix structural:
- Security (tenant isolation + RBAC self-scope) is built and tested in
  Phase 0, before any feature module — §3, §6.
- The design boards are the target from the first UI commit, not a later
  pass — §5.
- "DONE" in STATUS.md means tests pass AND it matches the design boards AND
  it's tenant-scoped — not a subjective call. See §6.1.
- Nothing paid gets built without the founder saying so — §7.

## 1. Source of Truth
`STUDYFY_PROJECT_SPEC.md` v3.2 is the living PRD + architecture doc —
authoritative for stack, tenancy, roles, features, UI/UX, security, deploy,
and cost. Ambiguity → the most reasonable interpretation consistent with the
spec's stated intent, recorded in §9.

## 2. Tech Stack (locked, spec §2)
- Frontend: Next.js (App Router) + React + TypeScript — `strict: true` +
  `noUncheckedIndexedAccess`, no exceptions.
- Styling: Tailwind CSS + vanilla CSS tokens (spec §8.2). UI base: shadcn/ui.
  Icons: Lucide only. Motion: Framer Motion. Charts: Chart.js/Recharts.
- Backend: Express.js + Node.js + TypeScript, separate from Next.js.
- Database: MySQL. ORM: Prisma. Auth: JWT (15m access + 7d refresh, httpOnly
  cookie) + bcrypt (cost ≥ 10).
- Realtime: Socket.io. Files: Cloudinary.
- PDF generation: PDFKit or `@react-pdf/renderer` — never Puppeteer (bad fit
  for Render's free-tier memory, spec §2).
- AI (Phase 3): Groq, free tier, default. OpenAI optional later, never required.
- Deploy: Vercel (web) + Render (api) + Aiven (MySQL) — all free tier.
- **No native mobile app.** Responsive web only. Don't build or reference an
  App Store/Play Store listing that doesn't exist.

## 3. Architecture Rules
- Multi-tenancy = shared DB, shared schema, `school_id` on every
  tenant-scoped table (spec §4). Never leak `school_id` into primary keys or
  business logic.
- Every tenant-scoped query MUST filter by `school_id`, enforced via the
  Prisma extension pattern in `SECURITY_PATTERNS.md` — not developer
  discipline alone.
- **When you add a new Prisma model that holds tenant data, add it to the
  tenant-scoping list (`TENANT_MODELS` in `SECURITY_PATTERNS.md`) in the same
  commit.** This exact gap — models added to the schema but not the scoping
  list — is how a prior attempt at this project leaked data across tenants.
- API base path `/api/v1/...`, tenant-scoped under
  `/api/v1/schools/:schoolId/...`. Envelope `{ success, data, error, meta }`.
  Cursor pagination for large lists.
- Composite indexes put `school_id` FIRST. Keep `attendance`/`marks` normalized.

## 4. Security Rules (non-negotiable, built in Phase 0 — spec §13)
- Zod validation at every route boundary.
- `tenantMiddleware` re-derives `school_id` from the JWT, never trusts client input.
- **The Platform Owner is the one role that never goes through
  `tenantMiddleware`** — it has no `school_id`. Its routes
  (`/api/v1/platform/...`) go through `platformOnlyMiddleware` instead
  (`SECURITY_PATTERNS.md` §2). A route gets exactly one of these two
  middlewares, never both, never neither.
- Password-reset and email-verification tokens are DB-backed (`auth_tokens`
  table) from the first commit — never an in-memory `Map` — and **single-use**:
  mark them consumed the moment they're used and reject reuse.
- Bulk CSV-imported accounts get a random temporary password + a "set your
  password" link through that same single-use token flow — never a shared
  default password.
- Any "verify"/"confirm" endpoint that matches a token MUST persist the
  resulting state change, with a test asserting the DB field actually
  changed — not just that the endpoint returned 200.
- `helmet`, CORS locked to real frontend origin(s), parameterized queries only.
- `.env` never committed. `/health` endpoint. Graceful shutdown on `SIGTERM`.
- Never leak stack traces or SQL errors to the client in production.
- Declare all routes BEFORE `export default router`.
- Mount every router exactly once — test every admin endpoint
  unauthenticated and assert 401/403.
- The public admission-enquiry endpoint needs rate limiting + a honeypot field.
- A suspended school (non-payment) blocks login/API access for its tenant
  users but keeps their data — never delete on suspension.
- **Messaging is not an open chat feature.** No student-to-student
  messaging; Teacher↔Student messaging is scoped to an actual teaching
  relationship; School Admin can view conversations in their school as an
  oversight capability (spec §13.7 — this product's users include minors).
- **Never ask the founder to paste a real secret (API key, database
  password) into a chat message, and never treat one pasted into chat as
  routine if it happens anyway.** Real credentials belong only in
  Vercel's/Render's/etc. dashboards or a local `.env` file, never in a
  prompt. If a secret does appear in a chat message — especially a
  Razorpay LIVE key — treat it the same as §13.8's live-key rule: stop,
  flag it, don't just quietly use it.

## 5. UI/UX Rules — the design boards are the target, minus the mockup noise
- The five images in `docs/designs/` (spec §8) are the visual specification.
  **Open and look at them before building each screen.**
- **Do NOT build these three things even though the reference images show
  them** (spec §8.1 explains why each one is mockup filler, not a real
  product decision):
  1. Role-selector tabs on the login screen — login is email + password +
     school slug, nothing else. Role is always server-derived.
  2. Fabricated trust stats on the landing hero ("500+ schools," "50K+
     students," "99% uptime") — there are no real numbers yet; don't invent
     them.
  3. App Store / Google Play badges — no native app exists (§2).
- Everything else in the five images (colors, sidebar structure, KPI
  layout, pricing cards, registration wizard) is the real target. Use spec
  §8.2 for exact color tokens, §8.3 for page content, §8.4 for the canonical
  sidebar nav per role (reconciled from the four variants, which don't
  fully agree with each other).
- Build the component layer on shadcn/ui, restyled with §8.2's tokens.
- Skeleton loaders, not spinners. Print stylesheets for report cards / ID
  cards / certificates / receipts.
- Parent/Student experience is mobile-first; Admin/Teacher data-heavy
  screens can be desktop-first.
- App-wide dark mode is explicitly out of scope — match the one
  light-canvas/navy-sidebar look first.
- No stock photography or licensed illustration packs — recreate imagery
  as CSS/SVG/Lucide compositions.
- **Pre-merge gate for every UI PR:** open the relevant board image side by
  side with the built screen (minus the three exclusions above). Visible
  deviation in sidebar structure, color, or KPI layout blocks the merge.

## 6. RBAC Rules
- Permissions in `roles` + `permissions` + `role_permissions` tables. No
  hardcoded role if/else checks scattered through the codebase.
- Roles: Platform Owner, School Admin, Teacher, Accountant, Student, Parent,
  Librarian (Phase 2), Transport Manager (Phase 2).
- **Row-level self-scoping for Student/Parent ships in Phase 0, with
  regression tests, before any Phase 1 feature module.** Write the test
  first — "a student cannot fetch another student's record" — then build
  the middleware (`SECURITY_PATTERNS.md`) to pass it, before building
  attendance/fees/exams on top of it.

## 6.1 STATUS.md Workflow — Definition of Done
A feature is `DONE` in STATUS.md only when **all** of the following are true:
1. Unit/integration tests exist and pass for its core logic.
2. If it touches tenant data, a test proves cross-tenant access is rejected.
3. If it has a UI, it visibly matches the relevant board (minus §5's three
   exclusions).
4. `npm audit`, lint, and the E2E smoke suite are green.

Workflow per task: read `STATUS.md` before starting → do the work → update
status using the Definition of Done above → `git add` + `git commit`
referencing the spec section → never skip the STATUS.md update.

## 7. Cost Rules (spec §1 — non-negotiable)
- Never add a paid API key, paid service, or billing integration without the
  founder explicitly saying to enable it.
- **SMS/WhatsApp is the one remaining deferred feature** — build it behind
  a stub/feature-flag; email (SMTP) is the real, working notification
  channel until/unless it's enabled.
- **AI features (Phase 3) build for real, now, on Groq's free tier** — not
  a stub. OpenAI is an optional future upgrade only, never required, never
  added without being asked.
- **Razorpay (Phase 2) builds for real — TEST MODE only, permanently.**
  Free test keys, no business verification needed, no real money, ever, in
  this project. Follow spec §13.8's full security checklist (signature
  verification, server-side amount recalculation, webhook idempotency,
  published test cards) — build it as if real money were moving through
  it, because doing it properly is the actual point, even though the money
  isn't real. **If the founder has live Razorpay keys from a separate,
  real, already-live project, those never go in this project under any
  circumstance** — a live key appearing here is a security incident, not a
  convenience: stop, flag it, don't use it.
- Phase 0 and Phase 1 must be completable and deployable on entirely free
  infrastructure (Vercel/Render/Aiven free tiers) — don't introduce a
  dependency that breaks that without flagging it first.

## 8. DSA Rules (spec §11)
Hash maps for RBAC/permission lookups; graph coloring for timetable
generation; heaps/top-K for exam ranks; sliding window for attendance
streaks and login rate-limiting; prefix sums for attendance %; tries for
name search; LRU cache for hot reads; union-find for import dedup. Don't
hand-roll what a database index already solves.

## 9. Process Rules
- Commit after every meaningful change. Never leave uncommitted work at the
  end of a session.
- Keep `STUDYFY_PROJECT_SPEC.md` updated as decisions change.
- **Whenever the spec's version number changes, update this file's own
  title and §1 version references to match, in the same edit.** This exact
  mismatch has happened twice already during planning — a stale version
  label here is a small thing, but it's a real instance of the same
  "things drift apart after a change and nobody re-checks" pattern that
  caused this project's worst bugs. Treat it accordingly, not as trivia.
- Reference the spec by section number in commits/notes.
- Test pure logic (grade calc, attendance %, timetable conflict, top-K
  rank) with unit tests.
- **Every access-control test needs to prove both directions, not just
  one.** A suite that only checks "the right person can get in" and never
  checks "the wrong person is kept out" isn't actually testing isolation —
  it's testing that the happy path works, which is a different and much
  weaker claim. Every tenant-isolation, self-scope, and RBAC test in this
  project asserts a rejection (403/401), not just a success.
- **When a task request covers more than one thing, or is genuinely
  ambiguous, ask which one to do first rather than attempting all of them
  at once or guessing.** Same when a reported bug is described vaguely —
  ask for the exact steps and exact output before attempting a fix, rather
  than guessing at the cause.
- `npm audit --audit-level=high` runs in CI on every PR and fails the build
  on high/critical findings (`.github/workflows/ci.yml`).
- **Before relying on `SECURITY_PATTERNS.md` or `.github/workflows/ci.yml`,
  treat them as patterns to adapt, not drop-in code** — type-check them
  against your actual Prisma schema and `package.json` scripts, fix any
  mismatches, and only then consider them part of your working setup. This
  is step 0 in `AGENT_START_HERE.md`, not optional.
- **Planning files (`STUDYFY_PROJECT_SPEC.md`, `RULES.md`, and the rest)
  get changed through the agent, not by the founder hand-editing them
  directly.** The reference-consistency work behind this plan (section
  numbers, cross-file links, version labels all matching) was genuinely
  fragile to get right — a quiet manual edit is exactly how that drifts
  back out of sync. If the founder wants something changed, that's a task
  like any other: make the edit, then re-check what else references it.

## 10. Explicit Instruction
**Every session: read `CURRENT_TASK.md` first, then `AGENT_START_HERE.md`,
then this file and the spec. Before any UI work, re-open the design images
in `docs/designs/` and re-check §5's three exclusions. Before writing a
query that touches tenant data, re-read §3/§4 and `SECURITY_PATTERNS.md` —
this is the area a prior attempt at this project failed most seriously, and
it fails silently if you don't check.**

## 11. Session Continuity Rules (multiple free models, no shared memory)
Work happens across sessions that may run on different free OpenCode
models (Muse Spark 1.3 primarily, another free model once its quota runs
out) — and a new model session has **zero memory** of any earlier
conversation. `CURRENT_TASK.md` exists specifically so an interruption
(laptop shut off, VS Code closed, quota switch) never loses work or context.
- **Update `CURRENT_TASK.md` continuously while working** — after each
  sub-step (every 10–15 minutes of work, not just when a whole feature is
  finished). This is the actual save point.
- Set `Status: IN PROGRESS` the moment a task starts; reset to `IDLE` only
  once it's genuinely finished and its result has been moved into
  `STATUS.md`.
- Prefer small steps that leave the repo **buildable** at each stopping
  point. If a step can't be split that small, say so explicitly in
  `CURRENT_TASK.md`'s "Repo state right now" line.
- Write down any decision, blocker, or context a fresh session couldn't
  infer from the code alone — assume the next session is a different model
  that has read nothing here.
- Commit to git after each sub-step (§9) as a second, complementary safety
  net — `CURRENT_TASK.md` is the primary one, since `git log` shows *what*
  happened but not *what's left* or *why*.
- Don't let the same detail live in both `CURRENT_TASK.md` and
  `STATUS.md` — the former is the one active task at step-level detail, the
  latter is finished features at phase-level detail.
- **A weaker fallback model's output on tenant isolation, RBAC, or
  self-scope code deserves a closer look than the same model's output on,
  say, a dashboard screen.** All the free OpenCode models can follow this
  plan, but they're not equally strong, and this is the one area where a
  subtle mistake is expensive. Flag it to the founder for review rather
  than quietly merging security-critical changes at the same confidence
  level as everything else.
