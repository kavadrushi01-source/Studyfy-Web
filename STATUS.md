# Studyfy — Build Status

**Started:** 2026-09-16 | **Last updated:** 2026-09-22

> Fresh tracker for a from-scratch build — no prior project's status carries
> forward. A row only moves to `DONE` when every box in the Definition of
> Done (below) is checked. Update this file per `RULES.md` §6.1, after every
> completed task. For the one task currently in progress, step-by-step, see
> `CURRENT_TASK.md` instead — this file only tracks finished features at the
> phase level.

## Definition of Done (a feature is not DONE until all four are true)
1. Unit/integration tests exist and pass for its core logic.
2. If it touches tenant data: a test proves cross-tenant access is rejected
   (`SECURITY_PATTERNS.md` §3).
3. If it has a UI: it visibly matches the relevant screen in `docs/designs/`
   (minus the three exclusions in spec §8.1 — login role tabs, fake trust
   stats, app-store badges).
4. Lint, `npm audit --audit-level=high`, and the E2E smoke suite are green.

---

## Phase 0 — Foundation + Security (nothing else starts until this row is DONE)
| Item | Status |
|---|---|
| Monorepo scaffold (spec §19) | DONE — workspaces + Next 16 web / Express api / shared-types / prisma, both build + serve (verified live 2026-09-16) |
| `tsconfig.json` strict mode, both workspaces | DONE — `strict` + `noUncheckedIndexedAccess` explicit in api/web (+ tests config), typecheck 0 errors |
| Prisma: full core schema from §9.1 in one pass — identity tables (schools+subscriptionStatus/users/roles/subjects/auth_tokens) AND classes/sections/students/student_guardians/staff/attendance/fees/exams/homework/notices (the seed script below needs all of it) | DONE — 25 models, 4 migrations, `migrate status` in-sync, `validate` clean; + `refresh_tokens` (auth rotation) and `enquiries` (public intake), each with its migration in the same commit |
| Auth: register/login (email+password, optional slug)/refresh, DB-backed tokens | DONE — 10 tests (gates, rotation + reuse-kill, enumeration-safe 401s) + live REST verification (register/login/refresh/429 paths) |
| Tenant-scoping Prisma extension + middleware | DONE — test-first (RED 200-leak shown), 20 TENANT_MODELS in sync with schema, URL-vs-token 403 + subscription gate |
| Platform-only middleware for the Platform Owner (separate from tenant middleware) | DONE — test-first (RED 404 shown), route audit proves one-middleware-per-route; no public owner creation (register hardcodes SCHOOL_ADMIN) |
| RBAC middleware | DONE — table-driven `requirePermission` (2 keys, 6 mappings seeded), TEMP-role deny→grant test + fail-closed ghost/typo tests. Honest note: unlike the other boxes, no RED run was shown first — middleware and tests were built together (fail-closed cases would have 404'd pre-route, but that run wasn't done) |
| Student/Parent row-level self-scope | DONE — test-first twice (404-RED, then 200-leak RED reproducing v1's bug), pins + list filtering + no-profile fail-closed |
| Seed script (School of Science + Ramakrishna School, full roster each — `DEMO_DATA.md`) | DONE — ran on dev: both ACTIVE with brand colors, 8 students each, 2-guardian Aditya case, deterministic attendance/fees/marks/homework/notices; 5-role live logins verified |
| Tenant-isolation + self-scope + platform-route regression tests passing | DONE — 30/30 across 7 files (auth 10, tenant 2, platform 4, self-scope 4, RBAC 3, hardening 5, hello 2) |
| helmet / CORS / rate limiting / health check / graceful shutdown | DONE — live demo: 5×401 then 429 RATE_LIMITED on 6th login; evil Origin gets no ACAO; nosniff set; shutdown drains + disconnects pool |
| CI green (lint, typecheck, unit, audit gate) | DONE — GitHub run 35059993545: all 5 jobs SUCCESS (fresh MySQL service, 6 test files passed in CI). Honest note: the E2E job is a green stub — real browser flows arrive with Phase 1 UI |
| Confirmed: no paid services wired yet (spec §1) | DONE — repo-wide grep 2026-09-16: no SMS/WhatsApp/Groq/Razorpay/OpenAI keys anywhere; only empty `.env.example` placeholders |

### Local dev environment (not code — operational note for the next session)
- MySQL sandbox on `127.0.0.1:3307` (own datadir in `Temp/opencode/studyfy-mysql-data`, root/empty pw). Local MySQL80 on 3306 untouched (credentials unknown). If port 3307 is dead, re-init + `Start-Process mysqld` detached (see git history for the exact commands) — never `Start-Job` (dies with the shell).
- `studyfy_dev` = seeded demo data (`npm run db:seed`); `studyfy_test` = test DB (migrated, roles/permissions seeded by test setup). Tests force `TEST_DATABASE_URL` — dev DB never touched.
- Prisma pinned at 6.12.0 (6.13+ pulls a HIGH audit failure via `@prisma/config`→`deepmerge-ts`).

## Phase 1 — MVP Modules
| Module | API | Web | Matches design board? |
|---|---|---|---|
| Student Information System | DONE — admission (users+students+guardians, one-time temp passwords), self-scoped profile, teacher-scoped sortable/paginated roster, Cloudinary documents (whitelist, school folders), PDFKit ID cards, class-teacher assignment | DONE — /students (DataTable), /students/new, /students/[id], /students/[id]/id-card (print CSS), /sections; pre-shell token-paste workflow until dashboards | Partial — board language (cards, pills, tables) matched; full sidebar shell lands in Chunk 5 dashboards |
| Attendance | IN PROGRESS (Chunk 2) — marking, summary, absentee email alerts, marking screen built; monthly/term reports UI pending | IN PROGRESS — /attendance/mark built | — |
| Fee Management | DONE — structures (term/category, exact decimals), idempotent bulk invoices, Decimal-exact manual payments (RAZORPAY structurally rejected), PDFKit receipts, school-tz reminders, self-scoped ledger with exact totals; live E2E verified | DONE — /fees (status pills, totals header), /fees/receipts/[id] print viewer | Partial — same pre-shell note as SIS |
| Exams & Gradebook | DONE — creation with subject links, bulk marks entry (class-teacher gate), round-then-grade letters, competition ranks, heap top-K with true ranks, PDFKit report cards (attendance % included); live E2E hand-verified incl. tie ranks | DONE — /exams/results (ranked board, top-K, grade pills), /students/[id]/report print viewer | Partial — same pre-shell note as SIS |
| Timetable | DONE — teacher_subjects qualifications (seeded per DEMO_DATA.md) + admin assignment endpoints; DSATUR-ordered greedy generator (partial + reasons, never hangs); manual slots with conflict + qualification checks; scoped section/teacher boards; live E2E incl. both degradation modes | DONE — /timetable (section picker, my-timetable, period×day grid); qualification assignment via API | Partial — same pre-shell note as SIS |
| Homework | DONE — posting gated on teaching relationship, text/file submissions (whitelist, school folders, resubmit-reopen), teacher grading, role-shaped boards with empty states; live E2E pending→graded lifecycle | DONE — /homework (status pills, empty-state card) | Partial — same pre-shell note as SIS |
| Notices | DONE — school/class/section publish with email delivery to affected parents/staff, scope-filtered board, cross-tenant rejection tested | DONE — /notices (publish + board, target pills, skeleton loading) | Partial — same pre-shell note as SIS |
| Parent-Teacher Chat | DONE — §13.7 matrix in mayMessage (linked only, §13.7 both-directions tests), send + thread read + threads list (previews + unread), admin oversight reads, message:new live emit via school namespace (namespace-room emit bug caught by live-delivery test + fixed); verified 2026-09-22: suite green + live dev-DB walkthrough (linked 201, unlinked 403, cross-tenant 403) | DONE — /messages (thread list + chat, always-visible Live/Reconnecting/Offline banner) | Partial — same pre-shell note as SIS |
| Role dashboards (all 6) | IN PROGRESS — School Admin DONE (...); Teacher DONE (...). Accountant DONE (...). Student DONE (self-scoped bundle: attendance %, averaged marks, live-invoice dues, next exam, today slots, 5 recent marks/notices; live-verified vs Aditya: 73.8/72/0.00, real marks, scoped notices). Parent/Owner NOT STARTED | IN PROGRESS — /dashboard admin DONE (...); /dashboard/teacher DONE (...); /dashboard/accountant DONE (...); /dashboard/student DONE (teal badge + §8.4 student nav, 4 KPI cards with honest nulls, timetable, marks, notices, quick links) | Partial — board language matched; full shell IS these pages |
| Public site + admission enquiry | NOT STARTED | NOT STARTED | — |

## Phase 2 — Differentiators (SMS/WhatsApp stays stubbed until spec §1 says go — Razorpay builds for real on TEST keys only, see §13.8)
| Module | Status | Notes |
|---|---|---|
| SMS/WhatsApp | NOT STARTED | Stub until a real gateway is deliberately enabled |
| Online fee payment (Razorpay/UPI) | NOT STARTED | **Build for real, TEST MODE only, permanently.** Follow spec §13.8's full checklist. Never add live keys — see §1/§13.8 |
| Library | NOT STARTED | |
| Transport | NOT STARTED | |
| HR/Payroll | NOT STARTED | |
| Admission CRM | NOT STARTED | |
| Certificate generator | NOT STARTED | |

## Phase 3 — Scale & Retention
| Module | Status | Notes |
|---|---|---|
| AI features | NOT STARTED | **Build for real on Groq's free tier** — not a stub. OpenAI stays optional/unused unless explicitly requested later |
| Analytics dashboard | NOT STARTED | |
| PWA / offline | NOT STARTED | |
| Biometric/RFID integration | NOT STARTED | |
| Inventory | NOT STARTED | |

*(Multi-language is not tracked here — it's not on the roadmap, spec §3.)*

## Phase 4 — Platform/Business
| Module | Status | Notes |
|---|---|---|
| Super Admin panel | NOT STARTED | |
| Subscription & billing | NOT STARTED | |
| Audit logs | NOT STARTED | |
| Data export/backup | NOT STARTED | |
| In-app support/tickets | NOT STARTED | |

## Bugs Found This Build
_(log these in `BUGSFIX.md`, not here — this file tracks status, not bug detail)_
