# 🎓 Studyfy — Multi-Tenant School Management System

A school management platform built with **Next.js, React, TypeScript, Express, Prisma, and MySQL**. One shared deployment serves multiple schools while keeping each school's students, staff, fees, and academic records isolated.

Studyfy provides role-specific workflows for school administrators, teachers, accountants, students, parents, and transport managers, with additional librarian and platform-owner access.

> **Demo data:** The seeded schools and accounts are fictional. Public demo-school accounts are read-only; do not enter real student or payment data.

---

## 🚀 Live Website

| Service | URL |
|---|---|
| Studyfy web app | [studyfy-web.vercel.app](https://studyfy-web.vercel.app) |
| API | [studyfy-api.onrender.com](https://studyfy-api.onrender.com) |
| API health check | [studyfy-api.onrender.com/health](https://studyfy-api.onrender.com/health) |

The API is hosted on a free tier and may take a little time to wake up after inactivity.

---

## 👋 Try the Demo

Open the [login page](https://studyfy-web.vercel.app/login), enter the school slug, then sign in with one of the seeded school-admin accounts:

| Demo school | School slug | Email | Password |
|---|---|---|---|
| School of Science | `school-of-science` | `kavita.rao@schoolofscience.demo` | `Demo@1234` |
| Ramakrishna School | `ramakrishna-school` | `s.venkataraman@ramakrishnaschool.demo` | `Demo@1234` |

These are synthetic demo accounts. Live demo sessions are read-only and expire after 30 minutes. The platform-owner account is intentionally not published.

### Why two schools?

The demo is designed to show tenant isolation, not just a collection of screens. School of Science and Ramakrishna School have separate staff, students, records, and branding. Signing in to one school must never expose the other school's data.

---

## ✨ Features

### 🏫 School administration

- Manage students, guardians, staff, classes, sections, subjects, and school settings.
- Import student rosters from CSV with per-row success and refusal reports.
- Upload school documents and generate printable student ID cards.
- Review school analytics, attendance trends, fee summaries, exam results, and section performance.
- Keep an audit trail of important administrative actions.

### 🧑‍🏫 Teaching and learning

- Mark daily attendance and review monthly or custom-range reports.
- Receive email alerts for absences.
- Create exams, enter marks, view ranked results, and generate printable report cards.
- Build and manage timetables with teacher-qualification and schedule-conflict checks.
- Assign homework, receive student submissions, and grade submitted work.
- Publish school-, class-, or section-level notices.

### 👨‍👩‍👧 Student and parent access

- Students view their own attendance, marks, homework, notices, and fee information.
- Parents view information only for their linked children.
- Parents and teachers exchange real-time messages through school-scoped chat.
- Students and parents can access relevant fee invoices and receipts.

### 💳 Fees and payments

- Create fee structures and invoices, record manual payments, and produce printable receipts.
- Track outstanding balances and overdue fees.
- Razorpay checkout is configured for **TEST MODE only**. Demo transactions do not charge real money; never add live payment keys to this project.

### 📚 Library, transport, and staff operations

- Catalog library books, issue and return copies, and track loans and overdue fines.
- Manage transport vehicles, routes, stops, and student assignments.
- Record staff attendance and leave, manage payroll, and generate salary slips.
- Generate bonafide, transfer, and character certificates.

### 🤖 AI-assisted tools

- Generate draft report-card remarks for teachers to review and edit before use.
- Analyze attendance patterns and surface anomaly insights for school staff.
- AI features use Groq when configured. Prompts are de-identified, and AI output is not treated as teacher-approved until reviewed.

### 📬 Enquiries and communications

- Collect admission enquiries through the public site and manage them through a staff CRM pipeline.
- Send email notifications for supported workflows.
- SMS and WhatsApp delivery are not enabled; phone numbers are stored as contact information only.

### 📱 Progressive web app

- Installable PWA with an offline shell and cached key screens.
- Previously loaded timetable and homework views can be opened offline.
- Homework submissions can be queued locally while offline and sent when connectivity returns.

---

## 👥 Roles

| Role | Main responsibilities |
|---|---|
| **Platform Owner** | Manage schools, platform billing, support, and platform-wide audit information |
| **School Admin** | Manage school users, students, classes, settings, and school operations |
| **Teacher** | Take attendance, manage teaching-related work, enter marks, grade homework, and message parents |
| **Accountant** | Manage invoices, payments, receipts, and financial workflows |
| **Librarian** | Manage the book catalog, issues, returns, and loans |
| **Transport Manager** | Manage vehicles, routes, stops, and student transport assignments |
| **Student** | View their own school records and learning information |
| **Parent** | View linked children's information and communicate with teachers |

Permissions are enforced by the API. Student and parent access is further scoped to the student's own record or the parent's linked children.

---

## 🛡️ Security and data handling

- School-scoped API and database access prevents cross-tenant record access.
- Student and parent endpoints enforce row-level self-scoping.
- Role and permission checks are enforced server-side.
- Authentication uses short-lived access tokens, refresh-token rotation, and secure cookies.
- Password reset tokens are single-use; public authentication and enquiry routes are rate-limited.
- Inputs are validated, security headers are enabled, and cross-origin access is allow-listed.
- Seeded demo data is synthetic. Demo-school logins are read-only in the public deployment.
- Use unique credentials and private environment secrets for real deployments. Never commit `.env` files or live payment credentials.

---

## 🧰 Tech Stack

| Layer | Technologies |
|---|---|
| Web | Next.js 16, React 19, TypeScript |
| API | Node.js 20+, Express 4, TypeScript |
| Database | MySQL, Prisma ORM |
| Authentication | JWT access/refresh tokens, secure cookies, bcrypt |
| Realtime | Socket.IO |
| Payments | Razorpay test-mode integration |
| AI | Groq API (optional configuration) |
| Files and documents | Cloudinary, PDFKit |
| Validation and security | Zod, Helmet, CORS allow-list, rate limiting |
| Testing | Vitest, Supertest, Playwright |

---

## 🏗️ Project Structure

```text
Studyfy-Web/
├── apps/
│   ├── api/                 # Express API, authentication, business logic, Socket.IO
│   └── web/                 # Next.js application and role-based pages
├── packages/
│   ├── demo-seed/           # Reusable synthetic demo data
│   └── shared-types/        # Types shared between web and API
├── prisma/
│   ├── schema.prisma        # MySQL data model
│   ├── migrations/          # Database migrations
│   └── seed.ts              # Idempotent demo-school seeder
├── docs/                    # User guide and restore documentation
├── .env.example             # Environment-variable template; contains placeholders
└── package.json             # npm workspaces and project scripts
```

---

## ⚙️ Getting Started

### Prerequisites

- Node.js **20 or newer**
- npm
- A MySQL database for local development

### 1. Clone and install

```bash
git clone https://github.com/kavadrushi01-source/Studyfy-Web.git
cd Studyfy-Web
npm ci
```

### 2. Configure environment variables

Use `.env.example` as a reference and create:

- `apps/api/.env` for database, authentication, and optional integrations.
- `apps/web/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:4000`.

Set `DATABASE_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET` for local development. Keep real credentials private and never commit environment files.

Prisma migration and seed commands run from the repository root/workspace and need `DATABASE_URL` in the current shell. Set it before the next step (replace the placeholders):

```powershell
$env:DATABASE_URL = "mysql://USER:PASSWORD@localhost:3306/studyfy"
$env:NODE_ENV = "development"
```

In Bash, use `export DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/studyfy"` and `export NODE_ENV=development`.

### 3. Migrate and seed the database

Make sure the API environment has a local MySQL `DATABASE_URL`, then run:

```bash
npm run db:migrate
npm run db:seed
```

The seed command creates two synthetic schools and repeatable sample records. In local development, seeded demo users use `Demo@1234` unless `DEMO_PASSWORD` is set.

### 4. Start the API and web app

Run each command in its own terminal:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- Web app: [http://localhost:3000](http://localhost:3000)
- API health: [http://localhost:4000/health](http://localhost:4000/health)

---

## 🧪 Useful Commands

```bash
npm run lint
npm run test
npm run build
npm run db:deploy
```

The web workspace also provides Playwright browser tests:

```bash
npm run test:e2e --workspace=@studyfy/web
```

---

## 📚 Documentation

- [User Guide](./docs/USER_GUIDE.md) — roles, login, demo schools, and using the app.
- [Demo Data](./DEMO_DATA.md) — seeded school details and demo-account policy.
- [Restore Guide](./docs/RESTORE.md) — database and environment recovery notes.
- [Project Specification](./STUDYFY_PROJECT_SPEC.md) — product requirements and architecture decisions.

---

## 📄 License

No license file is currently included in this repository. Contact the repository owner before redistributing or reusing the project.
