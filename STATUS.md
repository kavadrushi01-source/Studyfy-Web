# Studyfy — Build Status

**Started:** _(fill in)_ | **Last updated:** _(fill in)_

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
| Monorepo scaffold (spec §19) | NOT STARTED |
| `tsconfig.json` strict mode, both workspaces | NOT STARTED |
| Prisma: full core schema from §9.1 in one pass — identity tables (schools+subscriptionStatus/users/roles/subjects/auth_tokens) AND classes/sections/students/student_guardians/staff/attendance/fees/exams/homework/notices (the seed script below needs all of it) | NOT STARTED |
| Auth: register/login (email+password, optional slug)/refresh, DB-backed tokens | NOT STARTED |
| Tenant-scoping Prisma extension + middleware | NOT STARTED |
| Platform-only middleware for the Platform Owner (separate from tenant middleware) | NOT STARTED |
| RBAC middleware | NOT STARTED |
| Student/Parent row-level self-scope | NOT STARTED |
| Seed script (School of Science + Ramakrishna School, full roster each — `DEMO_DATA.md`) | NOT STARTED |
| Tenant-isolation + self-scope + platform-route regression tests passing | NOT STARTED |
| helmet / CORS / rate limiting / health check / graceful shutdown | NOT STARTED |
| CI green (lint, typecheck, unit, audit gate) | NOT STARTED |
| Confirmed: no paid services wired yet (spec §1) | NOT STARTED |

## Phase 1 — MVP Modules
| Module | API | Web | Matches design board? |
|---|---|---|---|
| Student Information System | NOT STARTED | NOT STARTED | — |
| Attendance | NOT STARTED | NOT STARTED | — |
| Fee Management | NOT STARTED | NOT STARTED | — |
| Exams & Gradebook | NOT STARTED | NOT STARTED | — |
| Timetable | NOT STARTED | NOT STARTED | — |
| Homework | NOT STARTED | NOT STARTED | — |
| Notices | NOT STARTED | NOT STARTED | — |
| Parent-Teacher Chat | NOT STARTED | NOT STARTED | — |
| Role dashboards (all 6) | NOT STARTED | NOT STARTED | — |
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
