# Layer 1 Matrix — §7 modules × roles × endpoints (2026-10-15)

Source of truth for allowed/denied: `ROLE_PERMISSIONS` in `prisma/seed.ts`
(single map, never per-route role lists). Route inventory: 154 unique
method+path pairs scraped from all routers + `app.ts` mounts (script output
in test run; the `route-auth-audit` test re-derives it every run and fails
the build on any unclassified route).

Auth paths found: tenant 118, platform 25, device 1, cron 1, bare-auth
(`/auth/me` only), fully-public 8 (register/login/refresh/logout/
forgot/reset, public enquiries, webhook-signature, health, hello).

## (a) The 27 §7 modules — where they live, how they're tested

| # | Module | Code | Tests |
|---|---|---|---|
| P0 | Auth/register/login/refresh/reset/logout | modules/auth | auth, auth-login-limiter, seed-password |
| P0 | Tenant middleware + Prisma extension | middleware/tenant, lib/prisma-tenant | tenant-isolation, security-matrix, route-auth-audit |
| P0 | Platform-only middleware | middleware/platform-only | platform, panel-proof paths |
| P0 | RBAC + self-scope | middleware/rbac,selfscope | rbac, self-scope, staff-self-scope |
| P0 | Seed (two demo schools) | prisma/seed + packages/demo-seed | seed-password, seed-concurrency, demo-safety |
| P0 | Rate limiting/helmet/CORS/health/shutdown | middleware/security, server.ts | auth-login-limiter, limiter files, security-matrix |
| P0 | CSV import (temp passwords, no shared default) | students-csv path | students-csv |
| 1 | SIS (admission/profile/roster/documents/ID) | modules/students,documents | students, documents, admission |
| 2 | Attendance + absentee email | modules/attendance | attendance, attendance-alerts, anomalies |
| 3 | Fees (structures/invoices/payments/receipts) | modules/fees | fees, fee-reminders, payments, invoices |
| 4 | Exams/marks/rank/report cards | modules/exams (+grades/marks/results) | exams, exam-results, marks, grades, report-cards |
| 5 | Timetable (partial + conflicts, manual edits) | modules/timetable | timetable, timetable-slots |
| 6 | Homework post/submit/grade | modules/homework | homework, homework-board, homework-submissions |
| 7 | Notices + email delivery | modules/notices | notices, mail-demo |
| 8 | Messaging + Socket.io (§13.7 matrix) | modules/messages, realtime/ | messages, message-threads, message-realtime, realtime |
| 9 | Six dashboards | modules/dashboard,metrics + web boards | dashboard tests, boards/accountant/parent/student/teacher/owner-dashboard |
| 10 | Public site + enquiry + honeypot | web app/page, modules/public | public, chunk2, human |
| 12 | Razorpay TEST online pay (§13.8 checklist) | fees-online path, lib/razorpay | billing-online, fees-webhook, payments |
| 13 | Library | modules/library | library |
| 14 | Transport | modules/transport | transport |
| 15 | HR/Payroll (+leave/staff attendance) | modules/payroll,staff | payroll, staff-self-scope, qualifications |
| 16 | CRM (enquiry → admission) | modules/crm | crm (in chunk2), admin |
| 17 | Certificates | modules/certificates | certificates |
| 18 | AI remarks/anomalies (Groq mocked) | lib/groq,grades,attendance-anomalies | exam-remarks-generate, anomalies, grades |
| 19 | Analytics | modules/metrics, dashboard/owner | owner-dashboard, analytics |
| 20 | PWA/offline | web manifest/sw | pwa, human (offline paths) |
| 21 | Biometric devices (3rd auth path) | modules/biometric | biometric, audit-device paths |
| 22 | Inventory | modules/inventory | inventory |
| 23 | Super Admin panel | modules/platform + web/owner/* | platform, platform-users, owner-dashboard, owner |
| 24 | Billing (§16.1) | modules/billing + jobs billing-cycle | billing, billing-gating, billing-owner, billing-online, billing-reminders, billing-invoice-pdf, invoices |
| 25 | Audit logs (§13.10) | modules/audit + web audit-logs | audit, audit-reads, audit-retrofit, audit.spec e2e |
| 26 | Export (§13.10) | modules/exports | data-export, data-export-limiter, demo-reset (demo slugs) |
| 27 | Tickets (§13.9 launch point) | modules/support | support-tickets, support-attachments, support-ticket-limiter |
| + | Impersonation (§13.9) | platform/impersonate, middleware/read-only | impersonation (19) |
| + | Demo hygiene (§13.11) | jobs demo-reset, read-only sessions, upload-caps, banner | demo-reset, demo-safety, read-only-session, demo-upload-caps, mail-demo |
| + | Settings (platform) | platform/settings + web/owner/settings | platform, owner settings e2e |
| + | School settings | web/settings | boards settings test |

(11 = SMS/WhatsApp stays a stub per §1 — verified stub-only, never wired.)

## (b) Roles × modules (allowed/denied from ROLE_PERMISSIONS)

- PLATFORM_OWNER: all `platform.*` only — zero school keys. Denied everything
  tenant-side by construction (no school_id → tenantMiddleware 401s).
- SCHOOL_ADMIN: every school key incl. `audit.read`, `billing.read`,
  `support.*`, `exports.manage`, `staff.manage`. Denied: all `platform.*`
  (20 routes × 7 roles = 140/140 403, panel-proof).
- TEACHER: students.read, sections.read, attendance.mark/read,
  notices.read/write, exams.manage/read, timetable.read, homework
  manage/read/grade, messages.send/read, documents.read, library.read,
  transport.read, payroll.read (own slip), inventory.read, dashboard.read,
  support.read/write. Denied: fees.*, payroll.manage, students.write,
  library.manage, transport.manage, certificates.*, crm.*, platform.*.
- ACCOUNTANT: +students.write, fees.manage/read, documents.write, crm.read,
  certificates.*, payroll.manage, support.*. Denied: attendance.mark,
  exams.manage, library/transport.manage, platform.*.
- STUDENT: own-scoped reads (attendance/marks/homework/timetable/fees/
  notices/messages/library/transport) + homework.submit. Denied: everything
  else, enforced by key + self-scope (unassigned-teacher, wrong-section,
  keyless-role tests).
- PARENT: linked-children reads + fee pay for own children only. Denied:
  everything else, incl. other families' invoices (tenant + self-scope).
- LIBRARIAN: library.read/manage + students.read + payroll.read (own).
  Denied: fees, payroll.manage, marks, attendance-write, student profiles,
  transport, platform (all 403-proven).
- TRANSPORT_MANAGER: transport.read/manage + students.read + payroll.read
  (own). Denied: same list as librarian (all 403-proven).

Self-scope specifics proven: pupil pinned to own loans/marks/fees; parent
with 1 child vs 2 children vs child-with-2-guardians (Aditya sees only
Aditya; Suresh sees only Aditya); teacher cannot read another teacher's
payslip/leave; omitted IDs default to caller, never all (self-scope,
staff-self-scope, parent-dashboard, payroll tests).

## (c) Endpoints: §10 list vs actually mounted

All 15 §10 table rows exist with the specified methods. Deltas found while
reconciling (all legitimate, recorded here, none a hole):
- `POST /platform/impersonate` + `/impersonate/end`, `/platform/read-only-session`,
  `/platform/schools/:id/exports`, `/schools/:schoolId/exports`,
  `/platform/settings`, `/owner`-console reads, PDF/receipt/slip downloads,
  CSV import, staff invite, device enroll — added by later phases, all
  classified tenant/platform by the audit test.
- No PUT routes exist anywhere (verified by inventory); updates ride POST/PATCH.
- `GET /api/v1/auth/me` is the single bare-auth (identity read) route.

## Coverage gaps found in Stage 1 → written before anything else

1. **No test pinned the route→auth-path mapping or TENANT_MODELS drift**
   (a new route without middleware, or a new schoolId model off the list,
   would ship silently). → `route-auth-audit.test.ts` (2 tests: full
   inventory vs allowlists; schema-vs-TENANT_MODELS). Caught 0 real holes;
   caught 2 of my own test bugs first (auth-vs-path counting, schema path).

## DoD re-verification (RULES §6.1, all DONE rows)

Re-ran for this walk: FULL API 96/96 + 456/456, FULL e2e 97/97 zero flakes
(DoD-walk turn), lint 0, audit 0 vulns, typechecks 0. Per-row boxes were
walked in that turn (tests pass / tenant-rejection proofs present / UIs
match written boards per screenshot review / gates green). No row fails —
nothing downgraded.
