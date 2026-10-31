# Studyfy — User Guide

Studyfy is a multi-tenant School Management System (School ERP). One deployment serves many schools, each on a paid subscription. This guide explains how to use the platform from scratch: roles, slugs, emails, demo data, and the owner setup.

---

## Table of Contents

1. [What is Studyfy](#what-is-studyfy)
2. [Roles & Permissions](#roles--permissions)
3. [School Slugs & Multi-Tenancy](#school-slugs--multi-tenancy)
4. [Demo Schools (Pre-Seeded)](#demo-schools-pre-seeded)
5. [Emails & Credentials](#emails--credentials)
6. [Owner (Platform Admin) Setup](#owner-platform-admin-setup)
7. [School Admin Dashboard](#school-admin-dashboard)
8. [Teacher Features](#teacher-features)
9. [Parent / Student Features](#parent--student-features)
10. [Accountant Features](#accountant-features)
11. [API Endpoints Overview](#api-endpoints-overview)
12. [Deployment & Live Site](#deployment--live-site)

---

## What is Studyfy

Studyfy is a cloud-based school management system where:

- **One deployment** serves **many schools** (multi-tenant SaaS).
- Each school has its own data, isolated from every other school.
- Features include: attendance, fees, exams, timetable, homework, notices, messaging, transport, library, payroll, support tickets, and data export.
- Built for portfolio + production-grade standards.

---

## Roles & Permissions

| Role | Can Do | School Scoped? |
|------|--------|----------------|
| **Platform Owner** | Manage all schools, billing, impersonate staff, view audit logs, export data | No (global) |
| **School Admin** | Manage their own school: staff, students, classes, settings, billing view | Yes |
| **Teacher** | Mark attendance, enter marks, create homework, post notices, message parents | Yes |
| **Accountant** | Manage fee invoices, payments, receipts, financial reports | Yes |
| **Librarian** | Catalog books, issue/return, manage library | Yes |
| **Transport Manager** | Manage routes, vehicles, student riders | Yes |
| **Student** | View own attendance, marks, homework, fee invoices, notices | Yes (self) |
| **Parent** | View children's attendance, marks, fees, pay invoices, message teachers | Yes (children only) |

**Important:** Student/Parent roles can **only** see their own data or their children's data — never another student's. This is enforced by row-level security on every query.

---

## School Slugs & Multi-Tenancy

Each school has a **slug** (URL-friendly identifier) used in URLs and login.

| School | Slug | Brand Color | Plan | Location |
|--------|------|-------------|------|----------|
| School of Science | `school-of-science` | Teal `#0D9488` | PREMIUM (Demo) | Ahmedabad, Gujarat |
| Ramakrishna School | `ramakrishna-school` | Maroon `#7F1D1D` | STANDARD (Demo) | Rajkot, Gujarat |

**Login URLs:**
- `https://studyfy-web.vercel.app/login` — choose school or omit slug for Platform Owner
- Tenant-scoped pages live under `/[school-slug]/...` in the app shell

**Tenant Isolation:** When logged in as School Admin of `school-of-science`, you **cannot** see `ramakrishna-school` students, fees, or staff. Every query is filtered by `schoolId`.


---

## Deployment & Live Site

### Current Live URLs

- **API:** `https://studyfy-api.onrender.com` (Render, main branch)
- **Web:** `https://studyfy-web.vercel.app` (Vercel)

### Deployment Pipeline

1. Code is pushed to `main` branch on GitHub
2. GitHub Actions CI runs (lint, typecheck, audit, tests, build, e2e)
3. If CI passes, PR is merged to `main`
4. Render auto-deploys the API and runs `prisma migrate deploy`
5. Vercel auto-deploys the web app

### ⚠️ Current Blocker

GitHub Actions is blocked on this account due to a billing/spending-limit issue. Until you resolve it at **GitHub → Settings → Billing and plans**, CI cannot run and the site cannot be deployed to production.

### To Deploy After Billing Fix

1. Fix GitHub billing (remove failed payment / reset spending limit to $0)
2. Re-run PR #1 checks → should pass on Linux runners
3. Merge `ui-premium-pass` → `main`
4. Render auto-deploys + runs production migration
5. Verify `https://studyfy-api.onrender.com/health` returns 200

### Environment Variables

**API (`apps/api/.env`)**

```
DATABASE_URL=mysql://user:pass@host:port/studyfy
JWT_ACCESS_SECRET=<long-random-string>
JWT_REFRESH_SECRET=<different-long-random-string>
CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud_name>
FRONTEND_ORIGIN=https://studyfy-web.vercel.app
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<brevo-login>
SMTP_PASS=<brevo-smtp-key>
SMTP_FROM=kavadrushi01@gmail.com
GROQ_API_KEY=<groq-key-for-ai-features>
RAZORPAY_KEY_ID=<razorpay-test-key-id>
RAZORPAY_KEY_SECRET=<razorpay-test-key-secret>
RAZORPAY_WEBHOOK_SECRET=<webhook-secret>
CRON_SECRET=<32+-char-random-string>
DEMO_PASSWORD=Demo@1234
OWNER_PASSWORD=<private-16+-char-password>
PLATFORM_GSTIN=<optional>
PLATFORM_STATE=Gujarat
```

**Web (`apps/web/.env.local`)**

```
NEXT_PUBLIC_API_URL=https://studyfy-api.onrender.com
```

---

## Security Notes

- **No live payment keys:** Razorpay is TEST MODE only. Never add live Razorpay keys.
- **No SMS/WhatsApp:** Deferred until you decide to pay for a gateway.
- **No secrets in repo:** `.env`, `.env.local`, `secret.md` are all gitignored.
- **Demo data is fictional:** The two seeded schools are for portfolio/demo use only. Never present them as real usage statistics.
- **Rate limiting:** Auth and public endpoints are rate-limited to prevent abuse.

---

## Support

For issues with this deployment:

1. Check `https://studyfy-api.onrender.com/health` — should return 200
2. Check GitHub Actions tab for CI status
3. Check Render dashboard for API service logs
4. Check Vercel dashboard for web deployment logs


---

## API Endpoints Overview

Base URL: `https://studyfy-api.onrender.com/api/v1`

### Auth (Public)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register (email + password + optional school slug) |
| POST | `/auth/login` | Login (returns JWT access + refresh cookies) |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Revoke refresh token + clear cookie |
| POST | `/auth/forgot-password` | Request password reset |
| POST | `/auth/reset-password` | Reset password with token |

### Tenant-Scoped (`/schools/:schoolId/...`)

Requires `tenantMiddleware`. All responses filtered by `schoolId`.

| Method | Endpoint |
|--------|----------|
| GET | `/schools/:schoolId/students` |
| GET | `/schools/:schoolId/staff` |
| GET | `/schools/:schoolId/fees` |
| GET | `/schools/:schoolId/attendance` |
| GET | `/schools/:schoolId/exams` |
| GET | `/schools/:schoolId/homework` |
| GET | `/schools/:schoolId/notices` |

### Platform Owner (`/platform/...`)

Requires `platformOnlyMiddleware` (separate from tenant middleware).

| Method | Endpoint |
|--------|----------|
| GET | `/platform/schools` |
| GET | `/platform/audit-logs` |
| POST | `/platform/internal/jobs/demo-reset` |
| POST | `/platform/internal/jobs/fee-reminders` |
| POST | `/platform/internal/jobs/billing-cycle` |

### Public Enquiry

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/enquiries` | Public school enquiry intake (rate limited) |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check (returns 200 when API is up) |


---

## School Admin Dashboard

The School Admin is the school's principal/head.

### Capabilities

- Manage staff (invite teachers, accountant, librarian, transport manager)
- Manage students and guardians
- Manage classes and sections
- View school-wide attendance, fees, exams, notices
- View subscription status and plan (`ACTIVE`, `TRIAL`, `PAST_DUE`, `SUSPENDED`)
- Brand color and school settings
- Data export for their school only

### School Admin Routes

- `/dashboard/school-admin` — main board
- `/schools/:schoolId/students` — student roster
- `/schools/:schoolId/staff` — staff management
- `/schools/:schoolId/fees` — fee invoices
- `/schools/:schoolId/attendance` — attendance overview
- `/schools/:schoolId/notices` — school notices

---

## Teacher Features

### Capabilities

- Mark attendance for their sections
- Enter marks for exams and subjects they teach
- Create homework assignments and review submissions
- Post notices to their classes
- Message parents of their students
- View timetable (if available)

### Teacher Routes

- `/dashboard/teacher` — teacher board
- `/classes/:id/attendance` — mark attendance
- `/exams/:id/marks` — enter marks
- `/homework/:id` — manage homework
- `/notices/:id` — post notices

---

## Parent / Student Features

### Parent Capabilities

- View all their children's profiles
- View attendance, marks, fee invoices for each child
- Pay pending/overdue invoices (Razorpay test mode)
- Message teachers

### Student Capabilities

- View own attendance, marks, homework, fee invoices
- View notices for their class/section
- Download ID card / report card

### Routes

- `/students/[id]` — student profile (self or child)
- `/students/[id]/report` — report card
- `/students/[id]/id-card` — ID card
- `/fees` — fee invoices (payable ones marked)

---

## Accountant Features

### Capabilities

- Create and manage fee structures
- Generate fee invoices per student/term
- Record fee payments
- Issue receipts
- View overdue/pending invoices
- Financial reports

### Routes

- `/accountant/fees` — fee management
- `/accountant/invoices` — invoice list
- `/accountant/receipts` — payment receipts


---

## Owner (Platform Admin) Setup

The Platform Owner has `school_id = NULL` (global access).

### First-Time Owner Setup

1. **Register:** Omit the school slug during registration → account is flagged as Platform Owner.
2. **Login:** Go to `/login`, enter email + password, leave school slug empty.
3. **Dashboard:** Redirects to `/dashboard/owner` (owner board).

### Owner Capabilities

- View all schools and their subscription status (`TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`)
- Impersonate any school staff (read-only, audited; excludes minors)
- View audit logs (platform-level and per-school)
- Manage support tickets (internal + school-facing)
- View revenue cards and subscription invoices
- Trigger data export (cross-tenant tested, excludes secrets)

### Owner Routes (under `/api/v1/platform/...`)

- `GET /platform/schools` — list all schools
- `GET /platform/staff-invites` — manage staff invites
- `POST /platform/impersonate/start` — start read-only impersonation session
- `POST /platform/impersonate/end` — end impersonation session
- `GET /platform/audit-logs` — view audit trail
- `POST /platform/internal/jobs/*` — cron-triggered jobs (fee reminders, billing cycle, demo reset)


---

## Emails & Credentials

### Demo Login Credentials (Public)

These are shared demo credentials for the seeded demo schools. **Do not use for real data.**

| Field | Value |
|-------|-------|
| Demo Password | `Demo@1234` (set via `DEMO_PASSWORD` env var) |
| Owner Password | `OWNER_PASSWORD` (private, 16+ chars, set via env var) |
| SMTP Host | `smtp-relay.brevo.com` |
| SMTP Port | `587` |
| SMTP From | `kavadrushi01@gmail.com` |

### How Emails Work

- **Demo mode:** All outbound emails are suppressed and never counted against limits (demo hygiene).
- **Brevo SMTP:** Used for real email delivery when SMTP credentials are configured.
- **Demo banner:** A teal banner appears on every page when in demo mode.

### Updating Demo + Owner Passwords (Live)

Run from the API directory with `DATABASE_URL` pointing at the live database:

```bash
npm run db:reset-demo-passwords --workspace=@studyfy/api
```

Environment variables needed:

- `DEMO_PASSWORD=Demo@1234`
- `OWNER_PASSWORD=<your-private-16+-char-password>`

This rewrites only `passwordHash` rows inside `isDemo` schools and the seeded owner's hash.


---

## Demo Schools (Pre-Seeded)

Two demo schools are pre-seeded for walkthroughs and portfolios. Both are `isDemo = true` with `ACTIVE` subscriptions.

### School 1 — School of Science (`school-of-science`)

- **Admin:** Dr. Kavita Rao (Principal)
- **Teachers:** Arjun Mehta (Math), Sneha Iyer (Physics/Chem), Rohit Deshmukh (Biology/EVS), Fatima Shaikh (English), Karan Mistry (Computer Science)
- **Accountant:** Vikram Solanki
- **Librarian:** Lata Nair
- **Transport Manager:** Ravi Nair
- **Students (8):** Aditya Sharma, Ishita Choudhary, Yash Gupta, Ananya Joshi, Rahul Verma, Priya Patel, Aarav Nair, Meera Pillai
- **Brand:** Teal `#0D9488`
- **Plan:** PREMIUM (shows all modules including Phase 3)

### School 2 — Ramakrishna School (`ramakrishna-school`)

- **Admin:** (Principal)
- **Teachers:** Same subject set, different staff names
- **Accountant:** (Accountant)
- **Students (8):** Separate roster
- **Brand:** Maroon `#7F1D1D`
- **Plan:** STANDARD (Phase 3 features gated with upgrade prompt)

**Demo Data Pattern (both schools):**

- **Attendance:** Last ~15 school days per student (85–98% attendance)
- **Fees:** One invoice per student per term; statuses: Paid / Pending / Overdue
- **Exams:** Unit Test 1 with marks across 2–3 subjects
- **Homework:** Two assignments per class (one graded, one pending)
- **Notices:** 2–3 recent notices per school (PTM, half-day, exhibition/annual day)
