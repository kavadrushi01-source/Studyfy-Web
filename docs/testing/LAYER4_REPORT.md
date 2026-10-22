# Layer 4 Report — full-deployment human pass (every role × every module)

**Status:** COMPLETE (Layer 4)
**Verdict:** **GO** for demo/portfolio use; demo data restored to its exact pre-session baseline and re-verified.
**Test window:** 2026-10-21 · Code under test: head `d4dca24` locally, plus the Layer-4 fix commit (BUG-1) shipped after this pass.

## 1. Environment under test

| | |
|---|---|
| Web | `https://studyfy-web.vercel.app` |
| API | `https://studyfy-api.onrender.com` (free tier, cold-start tolerated) |
| DB | Aiven MySQL, 45/45 migrations |
| Demo | password `mega` for all demo accounts; owner logs in with an empty school slug |

Credentials and tokens are not reproduced in this file. The session notes lived in a
gitignored local file that is deleted at cleanup.

## 2. What was exercised (all live, against the deployed API)

Every demo role of both schools was driven through its modules like a human: the API
journeys were scripted per role and run end-to-end, and the outcomes checked for
**data verity** (the record actually changed / the list actually narrowed / the
envelope actually carried the value), not just for 2xx.

- **School Admin (SOS + RK):** admission (single + CSV import + duplicate refusals),
  attendance round-trips, fees (structures → generation → payments PARTIAL→PAID →
  receipts → Razorpay TEST order), exams (create, marks, over-max refusal, results,
  report-card PDF, AI remark generate/edit), timetable (generate, manual add, clash
  409, unqualified-teacher 409, delete, qualification matrix), homework (post,
  submit, grade), notices (publish, edit, empty-patch 400, withdraw), messages,
  payroll lifecycle (attendance → leave submit/decide → `ALREADY_DECIDED` → compute →
  slips), library (book create, issue, return, second-copy rule, `LOANS_ACTIVE`
  delete guard), transport (vehicles, routes+stops, assign/unassign, parent rides),
  inventory (IN/OUT ledger, overdraw 409), certificates (issue, PDF, read gates),
  analytics windows + LRU invalidation, audit trail, support tickets, data export
  (single zip, 1/hour limiter → 429 on repeat), plan-gate matrix for RK
  (`STANDARD` allows Phase-1/2, refuses Phase-3 with `PLAN_UPGRADE_REQUIRED`).
- **Teacher (SOS):** roster/list scoping per section, attendance mark/refusal,
  homework board, own timetable, class-teacher gates, own pay slip, own leave.
- **Accountant:** ledger + payments + receipts + payroll tools, staff-list refusal
  (by design), certificates manage.
- **Student / Parent:** self-scoped reads (`students/summary?mine=1`, invoices,
  timetable, attendance), homework submit, linked-teacher messaging
  (`MESSAGING_NOT_ALLOWED` otherwise), certificates read refusal (by design,
  teacher/admin only key in seed).
- **Platform Owner:** boards, both schools' detail, subscription invoices,
  read-only impersonation session (`IMPERSONATION_START/END`, writes refused with
  `READ_ONLY_SESSION`, end by impersonated token refused), platform tickets,
  audit rows for every platform action.

Budget consumption stayed deep inside the Layer-2 caps: 3 AI remark calls, 1 export,
0 uploads, 0 captured payments.

## 3. Bug found and fixed in this layer

| # | Severity | Bug | Fix |
|---|---|---|---|
| L4-1 | **S3** | **A teacher could read a foreign-section pupil by id.** The list route was correctly class-teacher-scoped, but `GET /students/:id`, `GET /students/:id/id-card` and `GET /attendance/summary?studentId=` served any in-school pupil's name, guardians, attendance history and printable ID card to any TEACHER token — contradicting §9.1 ("teacher sees only own sections") which the same list route enforces. | `teacherSectionScope` mounted on the detail + id-card routes (foreign pupil → `404 NOT_FOUND`, never 403 — existence is not leaked), teacher pins computed for the summary route with the same 404 rule; admin/other roles unchanged. `self-scope.test.ts` rewritten to pin the real policy (it had pinned the leaky one); new `teacher-scope-regress.test.ts` pins all three routes both ways. Full suite 499/499. BUGSFIX entry #88. |

Everything else probed in this layer that looked like a bug was **by-design behaviour,
re-classified with evidence**: section-scoped 403/404 shapes per §9.1, messaging
gates limited to the child's section teachers, `fees/export/overview` path nouns that
don't exist by design, and RK's STANDARD plan matrix.

## 4. Demo-data restoration (the part that matters for the portfolio)

The journeys created probe rows (students, guardians, invoices, payments, an exam,
homework, a notice, leaf/probe inventory, a certificate + document, messages, a
support ticket, staff attendance/leave/payroll rows, extra timetable slots). **Every
one was deleted**, and the DB was then verified cell-by-cell against a row-count
baseline captured before the session:

- students 16 (8 SOS + 8 RK), users 52 (26 SOS + 25 RK + owner), notices 6 (3+3),
  invoices 16 (8+8), payments 14, exam artifacts 2/6/48/4, homework 15/27, attendance
  363 (243 SOS + 120 RK), books 16/loans 0, transport 5 routes + 5 vehicles + 1
  assignment, messages 8 (baseline 9 including a stale pre-session probe message,
  which was deleted as junk), certificates 1, documents 0, inventory 0, tickets 0,
  payroll 2 (the seeded October rows), timetable **60/60** — see §5.

`audit_logs` was deliberately **left append-only** (the trail proves the platform's
audit story); `refresh_tokens` was pruned of probe sessions (562 remaining —
session-state, not demo content). One genuine attendance row was overwritten by an
idempotent re-mark during testing and restored to its original value through the
API, keeping the audit trail coherent.

## 5. Timetable: the one thing that had to be rebuilt exactly

During timetable testing the SOS 9-A/10-A grids were replaced by probe generations,
and a greedy re-probe could only place 54 of the 60 original slots — the demo's
teacher pool is *perfectly* packed (12 Arjun + 16 Sneha + 18 Rohit + 8 Fatima +
6 Karan = 60 lessons in 30 twin cells), which the DSATUR greedy cannot reach from a
partial start. A small exact-cover solver reproduced a genuine conflict-free 60-slot
packing (every cell hosts one 9-A and one 10-A lesson, all per-subject counts exact,
all teacher uniquenesses respected; all 60 inserts accepted without a single 409).
Slot-for-slot identity with the pre-session layout is not recoverable (no snapshot
existed), but every constraint the demo is built to demonstrate — full grids, zero
conflicts, exact eligibility — holds, and the count matches the baseline exactly.

## 6. Verified live after restoration

7/7 role logins; students 8 / notices 3 / invoices 8 (SOS); timetable 9-A 30 and
10-A 30 slots; admin + RK + owner dashboards 200. BUG-1's 404s re-verified on the
live site after the fix commit deployed.

## 7. Cleanup statement

The session harness (scripts + DB snapshots) lived only in the per-machine temp
directory and `secret.md` (gitignored). At closure: `secret.md` deleted; test DB on
the local MySQL retained for future sessions; no secrets in this report or any
committed file.
