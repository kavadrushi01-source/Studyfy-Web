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

---

## Complete Feature List — What Studyfy Implements

Studyfy is a full-featured School Management System (SaaS ERP). Below is every major module built into the project:

### 1. Multi-Tenancy (Core Architecture)
- **One deployment, many schools** — each school's data is strictly isolated
- **School slugs** (`school-of-science`, `ramakrishna-school`) used in URLs and login
- **Tenant-scoping via Prisma Client Extension** — every query auto-filters by `schoolId`, developers cannot forget a `where` clause
- **Row-level self-scoping** — Students/Parents can only see their own data or their children's data
- **Cross-tenant regression tests** — prove that School A cannot access School B's data

### 2. Authentication & Authorization
- **Register / Login** — email + password + optional school slug (omitted = Platform Owner)
- **JWT Access (15 min) + Refresh (7 days)** — stored as httpOnly cookies
- **bcrypt cost ≥ 10** for password hashing
- **DB-backed auth tokens** (single-use, not in-memory)
- **Password reset** — single-use tokens with expiry, DB-persisted
- **Refresh token rotation** — theft kills all sessions
- **Logout** — revokes token and clears cookie
- **Suspended school gate** — suspended schools get 403 on login

### 3. Role-Based Access Control (RBAC)
- **Global roles/permissions** — seeded once, not tenant-scoped
- **`requirePermission` middleware** — table-driven, 2 keys, 6 mappings
- **Role hierarchy** — Platform Owner > School Admin > Teacher > Accountant > Librarian > Transport Manager > Student > Parent
- **Fail-closed** — unknown/typo permissions default to deny


### 4. Student Management
- **Student roster** — name, section, admission number, photo
- **Guardians** — one or two guardians per student (many-to-many via `student_guardians`)
- **Student profiles** — view own attendance, marks, homework, fee invoices
- **ID Card** — PDF downloadable student ID card
- **Report Card** — PDF downloadable term report with marks and grades

### 5. Attendance
- **Daily attendance** — Present / Absent / Late per student per day
- **Section-wise attendance** — teachers mark for their sections
- **Attendance % dashboards** — per student, per section, per school
- **Historical data** — last ~15 days seeded with realistic variation

### 6. Fees & Payments (Razorpay Test Mode)
- **Fee structures** — per class, per term (e.g., "Term 2 Tuition")
- **Fee invoices** — one per student per term, statuses: Paid / Pending / Overdue
- **Fee payments** — record manual payments
- **Receipts** — downloadable payment receipt PDFs
- **Razorpay Test Mode** — parents can pay pending invoices using test card `4111 1111 1111 1111` (zero real money)
- **Payment status pills** — visual indicators for Paid/Pending/Overdue
- **Parent payment dashboard** — all children's payable invoices in one place


### 7. Exams & Marks
- **Exams** — Unit Test 1, Midterm, Final (per school)
- **Exam subjects** — which subjects are included in each exam
- **Marks entry** — teachers enter marks per student per subject
- **Grade letters** — automatic grade calculation
- **Rank calculation** — top-K, heap-based ranking per class
- **Marks distribution** — varied, realistic scores seeded

### 8. Homework (with AI)
- **Homework assignments** — per class, with due dates
- **Submissions** — students submit work, teachers grade
- **AI Homework Generation** — Groq AI can generate homework assignments from prompts
- **Graded vs Pending** — both states visible in UI

### 9. Timetable
- **Period-by-period scheduling** — which subject, which teacher, which section, which time slot
- **Class teacher assignment** — set during school setup
- **Teacher-subject qualification** — `teacher_subjects` table drives timetable validity
- **Timetable views** — per class, per teacher, per section

### 10. Notices & Messaging
- **School-wide notices** — PTM dates, half-day announcements, exhibitions
- **Class-scoped notices** — targeted to specific sections
- **Read receipts** — track which parents/staff read notices (skipped under impersonation)
- **Messaging** — teacher ↔ parent communication
- **Message groups** — class groups, staff groups
- **Internal tickets** — support console with internal notes hidden from schools

### 11. Library
- **Book catalog** — add, edit, search books
- **Issue / Return** — track book loans to students
- **Book issues** — due dates, overdue tracking
- **Library desk** — librarian interface

### 12. Transport
- **Transport routes** — route names, stops, timings
- **Fleet management** — vehicles, drivers
- **Student riders** — assign students to routes
- **Transport desk** — transport manager interface

### 13. Payroll (Staff)
- **Staff salary records** — per teacher/staff member
- **Payroll processing** — monthly salary calculations
- **Payslips** — downloadable PDF payslips

### 14. Support & Tickets
- **Support tickets** — schools can raise tickets
- **Internal notes** — staff-only comments hidden from school users
- **Priority/status filters** — on support console
- **Ticket messages** — threaded conversation


### 15. Data Export & Backup
- **Cross-tenant data export** — 35 JSON files per school, excludes passwords/tokens/api keys
- **Streamed ZIP download** — admin-triggered export
- **DATA_EXPORT audit** — every export is logged
- **School detail UI** — view export history per school

### 16. AI Features (Groq — Free, No Card)
- **AI Homework Creation** — generate homework assignments from natural language prompts
- **AI Timetable Assistant** — suggest timetable arrangements based on teacher availability and subject load
- **Groq integration** — free tier, doesn't train on your data
- **Configurable model** — `GROQ_MODEL` env var (optional override)

### 17. Cloudinary (Media Storage)
- **Image uploads** — school logos, student photos, staff photos
- **Document storage** — receipts, invoices, report cards stored via Cloudinary
- **CLOUDINARY_URL** env var configuration
- **Optimized delivery** — automatic image transformations and CDN

### 18. PDF Generation
- **Student ID Cards** — downloadable PDF with photo, name, admission number
- **Report Cards** — term report with marks, grades, attendance %
- **Fee Receipts** — payment receipt PDFs
- **Invoice PDFs** — fee invoices with GST breakdown
- **Payslips** — staff salary slips
- **PDFKit** — server-side PDF generation

### 19. Subscription & Billing (Phase 4)
- **Plans** — TRIAL, ACTIVE, PAST_DUE, SUSPENDED
- **Plan gating** — STANDARD vs PREMIUM features
- **Subscription invoices** — per financial year, atomic invoice numbering
- **Billing cycle job** — hourly cron for transitions and reminders
- **Fee reminders** — automated payment reminders
- **GST breakdown** — CGST + SGST vs IGST based on `PLATFORM_STATE`


### 20. Scheduled Jobs (Cron)
- **Fee reminders** — hourly, per school
- **Billing cycle** — hourly, subscription transitions
- **Demo reset** — nightly (02:30 UTC), wipe and reseed demo schools
- **Cron secret** — `X-Cron-Secret` header, constant-time comparison
- **503 if unset** — never "open" when misconfigured

### 21. Audit & Security Logging
- **Audit logs** — append-only, allowlist-redacted fields (never passwordHash/tokens)
- **School-level + platform-level** — nullable `school_id` means platform action
- **Read-only sessions** — impersonation and demo accounts skip write operations
- **Socket.io handshake** — rejects read-only session claims
- **Request logger** — method/path/status/ms/user/imp on every line

### 22. Rate Limiting & Security Headers
- **`helmet`** — security headers (nosniff, etc.)
- **CORS lock** — evil origins get no `Access-Control-Allow-Origin`
- **Rate limiting** — on auth, public enquiry, export, ticket creation
- **Shared budget stores** — register/forgot/reset share one bucket (not separate)
- **Graceful shutdown** — on SIGTERM/SIGINT

### 23. Public Pages
- **Landing page** — hero with 3D canvas particle field, tenant isolation section, no pricing
- **Login / Signup / Forgot / Reset** — auth pages with show/hide password, remember me
- **Enquiry** — public school intake form
- **Health check** — `/health` endpoint


---

## Razorpay Test Mode — Parent Payment Flow (Detailed)

Studyfy integrates Razorpay in **TEST MODE only** — zero real money is ever involved. This lets parents walk through a complete payment flow for demo purposes.

### How It Works

1. **Parent logs in** as a parent of a demo school student
2. **Sees pending invoices** — all children's unpaid fee invoices appear on the parent dashboard with "Pay Fee" buttons
3. **Clicks "Pay Fee"** — Razorpay checkout opens in test mode
4. **Uses test card** — card number `4111 1111 1111 1111`, any future expiry, any CVV
5. **Payment succeeds** — Razorpay returns success, webhook verifies the payment
6. **Invoice status updates** — from `PENDING` to `PAID`
7. **Receipt generated** — downloadable PDF receipt is created automatically

### Test Card Details

| Field | Test Value |
|-------|-----------|
| Card Number | `4111 1111 1111 1111` |
| Expiry | Any future date (e.g., 12/30) |
| CVV | Any 3 digits (e.g., 123) |
| Name | Any name |
| Mode | TEST (no real money charged) |

### Environment Variables (Test Mode Only)

```env
RAZORPAY_KEY_ID=<razorpay-test-key-id>
RAZORPAY_KEY_SECRET=<razorpay-test-key-secret>
RAZORPAY_WEBHOOK_SECRET=<webhook-secret>
```

**⚠️ Important:** Never add live Razorpay keys to this project. A live key is a security incident, not a convenience. The integration stays test-mode permanently by design.

### Invoice Status Flow

```
PENDING ──(parent pays via Razorpay test)──► PAID
   │
   └──(manual payment recorded by accountant)──► PAID
   │
   └──(due date passes without payment)──► OVERDUE
```

---

## AI Features (Groq — Free, No Card Required)

Studyfy uses **Groq** for AI-powered features. Groq has a free tier, requires no credit card, and doesn't train on your data.

### AI Homework Creation

Teachers can generate homework assignments using natural language prompts:

1. **Teacher opens** the homework creation page for their class
2. **Clicks "Generate with AI"** — enters a prompt like "Create a 5-question biology quiz on cell structure for Grade 9"
3. **Groq processes** the prompt and returns a structured homework assignment with questions, answers, and due date suggestion
4. **Teacher reviews** — can edit, modify, or accept the AI-generated content
5. **Saves** — homework is published to the class, visible to students

### AI Timetable Assistant

The timetable generator uses AI to suggest optimal schedules:

1. **Input:** teacher availability, subject load per class, room constraints, period count per day
2. **AI suggests** — period-by-period timetable avoiding teacher conflicts and subject overloading
3. **Teacher/Admin reviews** — can manually adjust any slot
4. **Publishes** — timetable becomes visible to students and teachers

### Configuration

```env
GROQ_API_KEY=<your-groq-api-key>
GROQ_MODEL=optional-model-override
```

---

## Cloudinary Integration (Media Storage)

Cloudinary handles all image and document storage in Studyfy.

### What's Stored on Cloudinary

- **School logos** — brand images for each demo school
- **Student photos** — profile photos on ID cards and student profiles
- **Staff photos** — teacher and staff profile images
- **Receipts & Invoices** — payment receipts and fee invoice PDFs
- **Report Cards** — generated report card PDFs
- **Payslips** — staff salary slip PDFs

### Configuration

```env
CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud_name>
```

### Benefits

- **Automatic optimization** — images are resized and compressed on-the-fly
- **CDN delivery** — media served from Cloudinary's global edge network
- **Transformations** — on-the-fly cropping, resizing, format conversion
- **Reliable storage** — no local file system dependency

---

## PDF Generation (PDFKit)

Studyfy generates PDFs server-side using **PDFKit**. No external PDF service is needed.

### Downloadable PDFs

| PDF Type | Generated For | Contents |
|----------|--------------|----------|
| **Student ID Card** | Students | Photo, name, admission number, school, valid year |
| **Report Card** | Students/Parents | Term marks, grades, attendance %, teacher comments |
| **Fee Receipt** | Parents | Payment amount, date, invoice number, payment method |
| **Fee Invoice** | Parents/Accountant | Itemized fees, GST breakdown, due date, pay button |
| **Payslip** | Staff | Salary breakdown, deductions, net pay, pay period |

### PDF Generation Flow

1. **Data fetched** from database (student, marks, fees, etc.)
2. **PDFKit renders** — server-side PDF creation with formatted layout
3. **Uploaded to Cloudinary** — stored for reliable delivery
4. **Download link** — user clicks to download the PDF


---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 16.4.3, React 19.3.0 | App shell, dashboard pages, public landing |
| **API** | Node.js, Express 4, TypeScript | REST API, auth, webhooks, cron jobs |
| **Database** | MySQL 8, Prisma ORM 6.12 | Multi-tenant relational database |
| **Shared Types** | TypeScript packages | Shared interfaces between API and Web |
| **Authentication** | JWT (access + refresh), bcrypt, httpOnly cookies | Secure stateless auth |
| **Payments** | Razorpay (TEST MODE only) | Test-mode fee payments |
| **AI** | Groq (free tier) | Homework generation, timetable assistant |
| **Media** | Cloudinary | Image/document storage and CDN |
| **PDF** | PDFKit | Server-side PDF generation |
| **Testing** | Vitest (API), Playwright (E2E) | Unit + integration + browser tests |
| **Styling** | CSS (Tailwind-like utility classes) | Responsive UI, dark theme |
| **Linting** | ESLint 9 | Code quality enforcement |
| **CI/CD** | GitHub Actions, Render, Vercel | Automated testing and deployment |

### Workspaces (Monorepo)

```
studyfy/
├── apps/api/          # Express API (@studyfy/api)
├── apps/web/          # Next.js 16 frontend (@studyfy/web)
├── packages/shared-types/  # Shared TypeScript interfaces
├── packages/demo-seed/     # Demo data seeding package
└── prisma/              # Prisma schema + migrations + seed
```

---

## Security Architecture

Studyfy is built with security as a foundational principle, not an afterthought.

### Tenant Isolation
- Every tenant-scoped model has `schoolId` + composite index with `schoolId` FIRST (left-prefix rule)
- Prisma Client Extension auto-applies `where: { schoolId }` to all tenant-scoped queries
- `TENANT_MODELS` list in `SECURITY_PATTERNS.md` — every new model added to schema must be added to this list in the same commit
- **School table is NOT tenant-scoped** — it is the root; all school reads use explicit `where: { id }`

### Authentication Security
- Passwords hashed with bcrypt (cost ≥ 10)
- JWT access tokens: 15 minutes, refresh tokens: 7 days
- Refresh tokens stored in DB, single-use, rotation kills all sessions on theft
- Password reset tokens: DB-backed, single-use, identical rejects for enumeration safety
- No passwords or tokens ever logged or returned in API responses

### Authorization Security
- **RBAC middleware** — fail-closed, table-driven permission checks
- **Platform-only middleware** — separate from tenant middleware, owner routes never go through tenant scoping
- **Student/Parent row-level self-scope** — can only see own data or children's data
- **Read-only sessions** — impersonation and demo accounts blocked from writes at middleware level + socket handshake

### Audit & Logging
- **Audit logs** — append-only, allowlist-redacted (never `passwordHash`, never tokens)
- **Immutable** — no code path updates or deletes audit rows
- **Request logger** — method/path/status/ms/user/imp on every line (skipped in test mode)

### Dependency Security
- `npm audit --audit-level=high` — 0 vulnerabilities
- `archiver` replaced with streaming `yazl` to remove vulnerable nested `minimatch`
- `minimatch` overridden to 11.0.3 at root level
- No live SMS/WhatsApp keys — feature deferred
- No live Razorpay keys — TEST MODE permanently

---

## Phase Roadmap

### Phase 0 — Foundation + Security (COMPLETED)
- Monorepo scaffold, strict TypeScript, full Prisma schema (25 models, 4 migrations)
- Auth: register/login/refresh/logout, DB-backed tokens, password reset
- Tenant-scoping Prisma extension + middleware (test-first)
- Platform-only middleware for Owner
- RBAC middleware + Student/Parent row-level self-scope
- Seed script: 2 demo schools with full roster
- helmet/CORS/rate limiting/health check/graceful shutdown
- CI green: lint, typecheck, tests, audit

### Phase 1 — MVP Feature Modules (COMPLETED)
- Attendance, Fees, Exams, Homework, Timetable, Notices, Messaging
- Library, Transport, Payroll, Support Tickets
- All role-based dashboards (Owner, School Admin, Teacher, Accountant, Student, Parent)

### Phase 2 — Razorpay Payments (COMPLETED — Test Mode)
- Real Razorpay integration in TEST MODE
- Parent payment flow for pending invoices
- Receipt generation, invoice status tracking

### Phase 3 — AI Features (COMPLETED — Groq)
- AI homework creation from natural language prompts
- AI timetable assistant
- Free tier, no card required

### Phase 4 — Billing & Operations (COMPLETED)
- Subscription plans (TRIAL/ACTIVE/PAST_DUE/SUSPENDED)
- Billing cycle cron jobs, fee reminders
- Data export (35 JSON files, streamed ZIP)
- Demo hygiene (nightly reset, read-only demo sessions)
- Audit logs, impersonation (read-only, excludes minors)

---

## Support & Contact

For deployment issues:
1. Check `https://studyfy-api.onrender.com/health` — should return 200
2. Check GitHub Actions tab for CI status
3. Check Render dashboard for API service logs
4. Check Vercel dashboard for web deployment logs

**Demo Credentials:**
- Demo Password: `Demo@1234` (set via `DEMO_PASSWORD` env var)
- Owner Password: Set via `OWNER_PASSWORD` env var (private, 16+ characters)

**Important:** Demo data is fictional and for portfolio/walkthrough use only. Never present seeded schools as real usage statistics.

