# Studyfy — School Management System (Multi-Tenant SaaS)
### Full Project Specification v3.2 — fresh build, from zero, portfolio + production-grade
**Owner:** You | **Status:** Starting from scratch | **Last updated:** Sep 2026

> This is a **from-scratch build.** No code from any earlier attempt exists or
> is being reused — that project was deleted. Where this document references
> "an earlier attempt," it's only for the lessons it taught (what went wrong
> and why), never as a codebase to port forward. Feed this whole file to your
> coding agent — built via **OpenCode, using free models** (Muse Spark 1.3
> as the primary/preferred one, falling back to whichever other free
> OpenCode model is available once its free-tier quota runs out) — alongside
> the companion files listed in §19. Because different sessions may run on
> different models with **no shared memory between them**, `CURRENT_TASK.md`
> (§19) is what makes switching models mid-project safe.
>
> **v3.0 changes from the last draft:** (1) explicit cost/free-tier rules so
> nothing paid gets built without you deciding to; (2) subjects and curriculum
> reframed as an international core set, English-only, not tied to one
> country's board; (3) the login screen's role-selector tabs and other
> AI-mockup artifacts (fabricated trust stats, fake app-store badges) removed
> from the design spec — they looked like a real product decision in the
> reference images but weren't; (4) all "audit and reuse old code" language
> removed since there is no old code.
>
> **v3.1 changes:** (1) explicit dual-purpose framing — this is a portfolio
> project built to genuinely production-grade standards, not a toy; (2) AI
> features (§7 Phase 3) now default to **Groq — free, no card, doesn't train
> on your data** — instead of being stubbed-until-paid behind OpenAI; (3)
> Razorpay (§7 Phase 2) becomes a deliberate "build this for real" item, not a
> deferred stub — with dedicated payment-security treatment at §13.8; (4) two
> fully-specified demo schools (Demo Data section under §7, detail in the new
> `DEMO_DATA.md`) replace a single generic seed school.
>
> **v3.2 changes:** Razorpay is clarified further — the integration is
> genuinely built for real (§7 Phase 2, §13.8: real webhooks, real security
> checklist), but run in **TEST MODE only** — no real money, ever, in this
> project. A separate live project already exists for real payments; this
> one stays test-mode by design, not by half-measure.

---

## 0. Elevator Pitch

**Studyfy** is a multi-tenant, cloud-based School Management System (School
ERP): one deployment serving many schools, each on a paid subscription —
attendance, fees, exams, timetable, homework, and parent communication in one
place, the way Fedena/Teachmint (India-focused) or Alma/PowerSchool
(international) operate. It's built for **any English-medium school,
anywhere** — the subject list and language are deliberately generic/
international rather than tied to one country's curriculum (§3), while the
initial commercial market is India (₹ pricing, UPI, WhatsApp — §16).

**This is being built as a portfolio project — and that's exactly why it's
architected as a real one, not a toy.** The goal is a project worth showing
to employers: genuinely multi-tenant, genuinely secure, genuinely deployed.
Nothing here is a shortcut taken because "it's just a demo" — the tenant
isolation is real, the RBAC is real, and the payment integration is a
genuine, complete Razorpay integration (§13.8) that would handle real money
correctly the moment live keys were ever added — it just runs on free test
keys here, by design, since this isn't a real business. If a real school
ever wanted to use this, the answer should be "yes, mostly, and the payment
flow just needs live keys switched in" — not "let me rebuild the parts I
cut corners on." Two fully-seeded demo schools (see the Demo Data
section under §7) exist specifically so this is demonstrable, not
theoretical — an interviewer can see two independent tenants, correctly
isolated, both fully populated with realistic data.

---

## 1. Cost & Free-Tier Discipline — read this first

**You build and run the entire MVP for ₹0 / $0 — and, as of v3.1, that now
includes real AI features and a genuinely working payment integration, not
just the free-hosting basics.** This is a hard rule for the agent, not a
suggestion: nothing paid gets added to the codebase unless you explicitly
decide to enable it — see the "genuinely paid" table below, which is now
down to one deferred item.

**Free, always, no card required:**

| Thing | Free because |
|---|---|
| Next.js hosting | Vercel free tier |
| Express API hosting | Render free tier (750 hrs/month — cold-starts after inactivity, that's the only real downside) |
| MySQL database | Aiven free tier (~1GB, always free) |
| File storage | Cloudinary free tier |
| Email | Brevo free SMTP relay — 300/day, forever, no card (§2) |
| CI/CD | GitHub Actions free tier |
| Dev tools | VS Code + OpenCode, free models (Muse Spark 1.3 primary, any other free OpenCode model as fallback) |
| **AI features (Phase 3 — report card remarks, attendance anomalies)** | **Groq** — genuinely free tier, no card, fast, and doesn't train on your inputs by default (meaningfully better privacy than Gemini's free tier, worth caring about since this touches minors' data even in a demo). This is the default, not a stub — build it for real |
| **Online fee payment (Phase 2)** | **Razorpay, in TEST MODE.** Test keys are free to generate (no business verification needed, unlike live keys), no real money ever moves, and standard published test card numbers simulate success/failure. This is a real, complete integration — not a fake mockup — it's just never connected to a real bank. See §13.8, this is a genuine security-sensitive area even in test mode |
| Domain | Free `*.vercel.app` subdomain until you choose to buy a real one |

**Genuinely paid, off by default — you decide, not the agent:**

| Thing | Real cost | Rule |
|---|---|---|
| Custom domain | ~₹700–900/year | Only when you actually buy one |
| **SMS/WhatsApp gateway** | Per-message | The one remaining deferred item. **Do not wire a real provider or add its API key until you say so** — build Phase 2's notification feature behind a stub/feature-flag interface, with email (SMTP, already free) as the real, working notification channel in the meantime (§7 Phase 1) |
| Vercel/Render paid tiers | ~$5–15/month | Only once you outgrow free-tier limits with real paying schools — by then subscription revenue covers it |

**Optional future upgrade, not required for a complete project:**

| Thing | Real cost | Rule |
|---|---|---|
| OpenAI API | Pay-per-use | Groq already covers the AI features for free. Only add this later if you specifically want higher output quality than Groq's free models deliver — never as a requirement, and never wired in without you asking |
| **Razorpay LIVE mode** | ~2% per real transaction | This is a genuinely separate decision from building the integration itself — **do not switch to live keys in this project.** If Studyfy is ever actually sold to a real school later, that's the point to generate live keys and go through Razorpay's business verification — not before, and not as part of this build |

**Explicit instruction for the agent:** SMS/WhatsApp is the only feature
that stays behind a stub until told otherwise. AI features are built for
real now, on Groq, free. Razorpay is built for real — full integration,
real webhooks, real security checklist — but configured with **TEST keys
only**. Never add or accept Razorpay LIVE keys in this project under any
circumstance, including if asked casually — that's a separate, explicit
decision (§13.8 has the full reasoning). If a real live key is ever pasted
into this project by mistake, treat it as a security incident: stop, flag
it clearly, don't just quietly use it. Beyond what's listed above, never
add any other paid API key or billing integration without the founder
saying so.

### 1.1 First deployment — step by step
Knowing three services are free doesn't tell you how to connect them. Do
this once, in this order, after Phase 0 is done and tested locally:
1. Push the repo to GitHub.
2. Create an Aiven MySQL free service → copy its connection string into
   `DATABASE_URL`. Run `npx prisma migrate deploy` against it once (from
   your machine, using that connection string) to create the tables — do
   this before the API is live, not after.
3. Create a Cloudinary free account → copy `CLOUDINARY_URL`.
4. Deploy `apps/api` to Render: connect the GitHub repo, set the root
   directory to `apps/api`, set the build/start commands, and paste every
   API variable from `.env.example` into Render's dashboard — never commit
   the real values. Note the live Render URL.
5. Deploy `apps/web` to Vercel: connect the same repo, root directory
   `apps/web`, set `NEXT_PUBLIC_API_URL` to the Render URL from step 4,
   paste the web env vars into Vercel's dashboard.
6. Go back to Render and set `FRONTEND_ORIGIN` to the live Vercel URL from
   step 5, then redeploy the API — CORS will reject the frontend until this
   matches exactly.
7. Visit the live Vercel URL, run through registration → login end to end
   with a real (test) school before considering this "deployed."
8. Every schema change after this goes through `prisma migrate deploy`
   again against the same Aiven database — as a manual step before deploy,
   or wired into Render's build command once that's comfortable to
   automate. Don't let migrations drift from what's actually running.
9. Later, once you buy a custom domain (§1): point it at Vercel, add it in
   Vercel's dashboard, then update `FRONTEND_ORIGIN` on Render again to
   match — same reason as step 6.

---

## 2. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | **Next.js** (App Router) + React | SSR/SEO for the public site, CSR for dashboards |
| Language | **TypeScript**, `strict: true` + `noUncheckedIndexedAccess` | Catches null/undefined bugs at compile time instead of runtime |
| Styling | Tailwind CSS + vanilla CSS tokens | See §8.2 for the exact tokens |
| Backend | **Express.js** + Node.js + TypeScript, separate service from Next.js | Keeps the API reusable by a future mobile app |
| Database | **MySQL** | Correct fit for this relational shape (students↔classes↔fees↔exams) |
| ORM | **Prisma** | Type-safe queries matching the TS stack; schema is a single readable source of truth for both you and the agent |
| Auth | JWT (access 15m + refresh 7d, httpOnly cookie) + bcrypt (cost ≥ 10) | Standard, well-understood |
| Realtime | Socket.io | Chat, live notices |
| Email | **Brevo free SMTP relay** — 300 emails/day, forever, no card | Password reset, absentee alerts, fee reminders, notices (§7 Phase 0/1) — this is what "SMTP, free" means everywhere else in this document; naming it now so it's not left vague like every other free service already is |
| Files | Cloudinary free tier | Photos, documents, ID cards |
| PDF generation | **PDFKit or `@react-pdf/renderer`** — not Puppeteer | Report cards, receipts, certificates, ID cards all need PDFs (§7). Puppeteer needs a headless Chromium per generation, which is a bad fit for Render's free tier (~512MB RAM, cold starts) — a school generating 200 report cards at once could crash the instance. PDFKit/react-pdf render PDFs directly, no browser process, and stay well inside free-tier memory |
| AI provider (Phase 3) | **Groq** (free tier, default) — OpenAI optional later, never required | Report card remarks, attendance anomaly detection are short-text tasks that fit comfortably in Groq's free daily limits; Groq doesn't train on your inputs by default, which matters more here than in a typical side project since the inputs describe minors' academic data (§1) |
| Cache/Queue (later) | Redis (Upstash free tier) | Only add when actually needed — not Phase 0/1 |
| Deploy | Vercel + Render + Aiven MySQL | All free tier (§1) |

There is **no native mobile app** in this plan — "mobile" means the
responsive web app working well on a phone, not an App Store/Play Store
listing. Don't build or market a native app that doesn't exist (§8.1).

---

## 3. Curriculum & Subjects — International, English-Only

Two deliberate product decisions, not just scope cuts:

**Language: English-only**, UI and instruction both. No translation/i18n
system. This mirrors how real international-curriculum schools (IB,
Cambridge/IGCSE, American-system) already operate — one consistent
English-medium experience regardless of host country.

**Subject list: a universal academic core**, not one country's board
syllabus. Default subjects seeded on school setup:

| Subject | Group |
|---|---|
| Mathematics | Core |
| Physics | Science |
| Biology | Science |
| Chemistry | Science |
| Earth Science | Science |
| Environmental Science | Science |
| Astronomy / Space Science | Science |
| English | Language |
| Computer Science / Computing | Core |

Schools can add or remove subjects during setup — this is the default seed
list, not a hard limit. Splitting science into distinct disciplines rather
than one lumped "Science" subject deliberately mirrors how IB/Cambridge
structure sciences, since that's the more globally portable shape.

**Content vs. market — these aren't in conflict:** the subjects and language
are international by design so the product works for any English-medium
school anywhere. The initial commercial go-to-market still targets India
specifically (₹ pricing, UPI, WhatsApp/SMS, §16) because that's your actual
starting market — an English-medium, internationally-structured school in
India is exactly the customer this is built for.

---

## 4. Multi-Tenancy

**Shared DB, shared schema, `school_id` on every tenant-scoped table.** One
MySQL database, one Express deployment, one Next.js deployment serves every
school, every query scoped by `school_id`.

- Free-tier friendly, cheapest to run, one deploy patches every school.
- Every tenant-scoped query MUST filter by `school_id` — enforced
  structurally via a Prisma extension (§13.4, code in `SECURITY_PATTERNS.md`),
  not developer discipline alone. **Build this in Phase 0, before any
  feature module** — see §6 and §17.

---

## 5. User Roles & Permissions (RBAC)

| Role | Scope | Key powers |
|---|---|---|
| Platform Owner (you) | Cross-tenant | Onboard/suspend schools, billing, platform analytics, audited impersonation |
| School Admin | Single school | Full configuration, staff, classes/sections, fees, admissions, all reports |
| Teacher | Assigned classes/sections only | Attendance, grades, homework, message parents, own timetable |
| Accountant | Single school | Fee collection, invoices, receipts, financial reports |
| Student | Self only | Own attendance/grades/homework/timetable/fees, submit homework, message teachers |
| Parent | Own linked children only | Children's data, pay fees, message teachers, notices |
| Librarian / Transport Manager (Phase 2) | Single school | Module-specific |

`roles` + `permissions` + `role_permissions` join table — never hardcoded
role if/else scattered through the code.

**Architectural exception: Platform Owner sits outside the tenant model
entirely.** Every other role belongs to exactly one school (`school_id` on
their user row) and every route they hit goes through `tenantMiddleware`.
The Platform Owner belongs to no school — `school_id` is `NULL` on their
user row, they never go through `tenantMiddleware` at all, and their routes
live under a separate `/api/v1/platform/...` path with their own
`platformOnlyMiddleware`. If you build this the same way as the other five
roles, it will not work — see §13.4 for the full explanation and
`SECURITY_PATTERNS.md` for the code.

**Non-negotiable:** row-level self-scoping for Student/Parent (a student can
only read their own record; a parent only their linked children's) ships in
Phase 0 with regression tests proving it, **before** any Phase 1 feature
module is built on top of it. This is the single area where a prior attempt
at this exact project failed worst — see `SECURITY_PATTERNS.md`.

---

## 6. Build Order — Why Sequencing Matters

The single biggest lesson from an earlier attempt at this project: building
many modules in parallel (library, transport, payroll, AI, PWA — all at
once) produced a lot of surface area with a critical security gap
undiscovered underneath it for a long time. This time, **Phase 0 must be
100% done and tested before Phase 1 starts, and Phase 1 must be deployed and
matching §8's design exactly before Phase 2 starts.** Not a suggestion —
see the checklist in `AGENT_START_HERE.md`.

---

## 7. Feature Modules (Phased)

### Phase 0 — Foundation + Security (nothing else starts until this is done)
- Multi-tenant school onboarding, auth (register/login/JWT refresh/reset),
  tenant middleware, **platform-only middleware for the Platform Owner
  (§5, §13.4 — a real exception, not an edge case to skip)**, RBAC
  middleware, **student/parent row-level self-scope with regression tests** (§5)
- School profile setup: name, logo, address, timezone (§12.7), academic
  year, classes, sections, and the default subject list from §3 (editable)
- Bulk CSV import for students/staff — **temporary per-account passwords via
  the single-use token flow, never a shared default password (§13.3)**
- **A seed script** creating **two fully-populated demo schools** (School of
  Science and Ramakrishna School — see the Demo Data section below and
  `DEMO_DATA.md`), each with a full role roster and sample
  attendance/fees/marks — one school alone doesn't demonstrate tenant
  isolation; two, correctly kept separate, does
- Rate limiting on auth endpoints; `helmet`, CORS lock, health check,
  graceful shutdown (§13)

### Phase 1 — MVP (deploy this, pilot it with one real school, before Phase 2)
1. Student Information System — admission, profile, documents, ID cards
2. Attendance — daily marking, monthly/term reports, **absentee alerts via email (SMTP, free) — this is the real, working notification channel until/unless SMS/WhatsApp is enabled in Phase 2, not a placeholder**
3. Fee Management — structures, invoices, payment recording, reminders (email), PDF receipts
4. Exams & Gradebook — schedules, marks entry, auto grade/rank, PDF report cards
5. Timetable — auto-generated, conflict-free (§10 graph coloring)
6. Homework/Assignments — post, submit, grade
7. Notice Board — school-wide / class-wide, with email delivery to affected parents/staff
8. Parent-Teacher Messaging — 1:1 chat, Socket.io, scoped per §13.7 (this platform's users include minors — no open student-to-student messaging)
9. Six role dashboards matching §8 exactly (Admin, Teacher, Accountant, Student, Parent, Platform Owner)
10. Public marketing site + admission enquiry page matching §8.3 exactly

### Phase 2 — Competitive Differentiators (only after Phase 1 is deployed and stable)
11. SMS/WhatsApp notifications — build behind a stub until you decide to pay for a real gateway (§1) — email already covers this need for free in the meantime
12. **Online fee payment (Razorpay/UPI, TEST MODE) — build this for real, with the full §13.8 payment-security treatment** (signature verification, server-side amount recalculation, webhook idempotency, test/live key separation) — genuinely integrated, not a stub, but running on Razorpay's free test keys only. See §1/§13.8 for why live keys never belong in this project
13. Library management
14. Transport management
15. Staff HR & Payroll (basic)
16. Admission/Enquiry CRM (public form → pipeline)
17. Certificate generator

### Phase 3 — Scale & Retention (only after Phase 2 is stable)
18. **AI features (report-card remarks, attendance anomaly detection) — built for real on Groq's free tier (§1, §2)**, not a paid stub. Keep prompts free of unnecessary student PII where the task doesn't need it (e.g. use "this student" rather than full name where the remark doesn't require it) — good practice regardless of provider, and worth being deliberate about given Groq/most free tiers' data-use terms
19. Analytics dashboard for admins
20. PWA / offline-first
21. Biometric/RFID attendance device integration
22. Inventory management

*(Multi-language is not on this roadmap at all — §3 already covers why English-only is a deliberate product decision, not a deferred feature.)*

### Phase 4 — Platform/Business
23. Super Admin panel matching §8.3's board exactly
24. Subscription & billing — plan tiers, trial, auto-suspend, GST invoicing. **How schools actually pay Studyfy is a separate open decision from §7 Phase 2's Razorpay integration** (that one is parents paying schools; this is schools paying you) — if it also uses Razorpay (e.g. Razorpay Subscriptions, a different product from one-time orders), the same §1/§13.8 test-mode-only rule applies for the same reason: this is a portfolio project, not a live business collecting real subscription fees yet
25. Audit logs
26. Data export/backup per school
27. In-app support/ticketing

### Demo Data — Two Reference Schools
One seeded school can't demonstrate the thing this whole plan is built
around — tenant isolation. Two independent, fully-populated schools, kept
correctly separate, can: log in as School of Science's admin, and
Ramakrishna School's students/fees/marks simply don't exist from that
vantage point. That's the actual proof, and it's a genuinely strong thing
to show in a portfolio walkthrough.

| | School of Science (SOS) | Ramakrishna School |
|---|---|---|
| Character | Modern STEM-focused secondary school | Established, traditional secondary school |
| Slug | `school-of-science` | `ramakrishna-school` |
| Brand color (§8.2/§12.6 theming demo) | Teal/cyan | Maroon/deep red |
| Subjects | Full §3 default list (thematically fits "Science" well) | Same §3 default list — same curriculum, different institution, proving the subject seed is genuinely per-school data, not hardcoded |

Full roster detail (admin, teachers per subject, an accountant, 2–3
classes/sections, ~8–10 named students each, guardian links — including at
least one student with **two** linked guardians to exercise the
`student_guardians` join table, §9.1 — plus sample attendance, fee
invoices, exam marks, homework, and notices) is specified in `DEMO_DATA.md`.
Follow it for the actual names and structure — don't invent different ones,
consistency here is what makes screenshots/demos reusable.

---

## 8. UI/UX Design System — Match the Reference Boards, Minus the Mockup Noise

You supplied five reference images. They're the literal visual target for
colors, layout, and page structure — **with a few specific exceptions below,
where the images show things a real product wouldn't actually do.** Save all
five into `docs/designs/` (filenames in §19) so the agent can open and view
them directly — Muse Spark 1.3 takes image input, so use it when that's the
active model; if a fallback OpenCode model without image input is active
instead, work from §8.2–8.4's written specification, which is why those
sections are written to stand on their own without requiring the images.

### 8.1 What to ignore from the reference images (AI-mockup artifacts, not real decisions)
Going back through the images specifically for this: these three are
generated-mockup filler, not things to build.

1. **Role-selector tabs on the login screen** (Admin/Teacher/Student/Parent
   tabs above the login form). A real login screen doesn't ask which role
   you are — the account determines that server-side. **Don't build this at
   all** — the login form is just email + password + school slug (§8.3).
2. **Fabricated trust stats on the landing hero** ("500+ Happy Schools · 50K+
   Students Managed · 99% Uptime"). This is a pre-launch product with zero
   real schools — shipping invented customer/uptime numbers is a false
   advertising claim, not a placeholder. Don't build a stat row with numbers
   at all until they're real; if you want something there, use a factual,
   non-customer-count line instead (example in §8.3's Hero bullet).
3. **App Store / Google Play download badges.** There's no native app in
   this plan (§2) — badges implying a downloadable app that doesn't exist
   are misleading. If you want to show the mobile experience, show
   responsive screenshots with copy like "works great on any phone," not
   store badges or install claims.

Everything else in the five images — colors, sidebar structure, KPI card
layout, pricing cards, registration wizard — is a real, intentional
reference. The rest of this section (§8.2 onward) already reflects these
three exclusions; treat it as authoritative over the raw images wherever
they'd otherwise conflict.

### 8.2 Visual identity (locked)

| Token | Value | Used for |
|---|---|---|
| `--color-sidebar-bg` | Dark navy, `#0F172A`–`#111827` | Every dashboard sidebar, all roles |
| `--color-primary` | Mid blue, `#2563EB` | Primary buttons, active nav, links, primary chart series, logo mark |
| `--color-canvas` | Very light slate, `#F8FAFC`–`#F1F5F9` | Dashboard content background |
| `--color-card-bg` | White | Content cards, soft shadow + `12–16px` radius |
| `--color-success` | Green `#059669`/`#10B981` | Present, paid, active |
| `--color-warning` | Amber `#F59E0B`/`#D97706` | Pending, trial, due-soon |
| `--color-danger` | Red `#DC2626`/`#EF4444` | Absent, overdue, suspended |
| Font | Inter (system-ui fallback) throughout | All UI text — one clean sans, no second display font |
| Logo | Blue rounded-square "S" + "Studyfy" wordmark | Every sidebar top, public nav |

**Role badge colors** (the four reference variants don't fully agree with
each other — standardize on this):

| Role | Badge color | Icon |
|---|---|---|
| School Admin | Blue `#2563EB` | Crown / graduation cap |
| Teacher | Green `#059669` | Graduation cap |
| Accountant | Purple `#7C3AED` | Wallet / coin |
| Student | Teal `#0D9488` | Graduation cap |
| Parent | Pink `#DB2777` | Person |
| Platform Owner | Navy `#0F172A` badge, amber `#F59E0B` accent | Shield |

### 8.3 Page-by-page specification

#### Public site
- **Nav:** logo left; `Home / Features / Pricing / About / Contact` center; `Login` + `Get Started` button right.
- **Hero:** headline **"Modern School Management System for a Brighter Future"**, subtext, primary CTA `Get Started Free` + secondary `Watch Demo` (**only build "Watch Demo" once an actual demo exists** — otherwise use a CTA that scrolls to the feature section instead of promising a video that isn't there). No fabricated stat row (§8.1) — if you want a line there, something factual: *"9 core subjects · Built for any English-medium school · 14-day free trial."*
- **Features section:** heading **"Everything You Need in One Platform"**; cards for Student Management, Attendance, Fees & Payments, Exams & Marks, Timetable, Homework, Notices, Parent Communication, Reports & Analytics.
- **Pricing:** heading **"Simple, Transparent Pricing"**, three cards:

  | Plan | Price | Positioning |
  |---|---|---|
  | Basic | ₹2,999/month | Up to 500 students, core features, email support |
  | Standard *(Most Popular)* | ₹5,999/month | Up to 1,500 students, all core features, priority support |
  | Premium | ₹9,999/month | Unlimited students, advanced features, 24/7 support |

  Footnote: *14-day free trial · No setup fee · Cancel anytime.*
- **Footer:** logo + tagline, `Secure / Fast / Scalable / Multi-Tenant SaaS` badges, "Better Schools. Brighter Futures."
- **Mobile section:** responsive screenshots with "works great on any phone" framing — no store badges (§8.1).

#### Login (rebuilt per §8.1 — no role tabs)
Centered card: "Welcome Back!" / "Sign in to your school account". Fields:
**school slug (optional)**, email, password. "Remember me" + "Forgot
password?". Primary `Login` button. "Sign in with Google" **only if OAuth
is actually wired** — never ship a button that does nothing. "Don't have an
account? Sign up." The school slug identifies which tenant you're logging
into on a single shared login page — not a picker screen, not a subdomain —
**and it's optional specifically for the Platform Owner**: slug provided →
look up the user by `(school_id, email)` within that school; slug omitted →
look up a Platform Owner account by `email` where `school_id IS NULL`. One
login form covers both cases; don't build a second login page for the
Platform Owner.

#### Registration
3-step wizard — **Step 1 School Details** (School Name, School Type, Phone,
Email, City, State) → **Step 2 Admin Details** → **Step 3 Complete** — step
indicator, one `Next →` action per step. The school's login slug
auto-derives from the School Name in Step 1 (editable). **This endpoint is
the one deliberate exception to §13.4's tenant middleware** — there's no
`school_id` to derive from a JWT yet, because the school doesn't exist until
this request creates it. It uses the raw, unscoped Prisma client for exactly
this one write, then every subsequent request from that new admin goes
through the normal tenant-scoped path.

#### Role dashboards (all six)
Dark navy sidebar with role badge (§8.2), canonical nav (§8.4), light-canvas
content area, "Good morning, {name}" header, 3–4 KPI cards, role-specific panels:

| Role | KPI cards | Main panels |
|---|---|---|
| School Admin | Total Students, Total Teachers, Total Classes, Fee Collection | Student Growth line chart, Recent Activities feed, Quick Actions |
| Teacher | My Classes, Today's Attendance, Homework Pending, Messages | Today's Timetable, Quick Actions, Upcoming Homework/Exams, Recent Messages |
| Accountant | Total Collected, Pending Fees, Overdue Fees, Total Students | Fee Collection Trend chart, Payment Status donut, Recent Transactions table |
| Student | Attendance %, Overall Marks, Fees Due, Next Exam | Today's Timetable, Recent Marks, Recent Notices, Quick Links |
| Parent | (per selected child) Attendance %, Average Marks, Fees Due, Upcoming Exams | Child selector, Child Progress chart, Recent Notices, Quick Actions |
| Platform Owner | Total Schools, Active Schools, Trial/Pending, Total Revenue | Searchable Schools table, Platform Analytics chart, Subscription Plans donut |

**Sequencing note:** this dashboard is built in Phase 1 (§7 item #9, matching
the board's full layout), but "Total Revenue" and "Subscription Plans"
depend on billing data that doesn't exist until Phase 4 (#24) actually
implements it. Build the real layout now with these two cards showing
`0`/empty rather than fake numbers (§8.1's no-fabricated-data principle
applies here too) — "Total Schools" and "Active Schools" are genuinely
live from Phase 1 since they just count `schools` rows.

### 8.4 Canonical sidebar navigation per role
- **School Admin:** Dashboard · Students · Teachers · Classes & Sections · Attendance · Fees & Payments · Exams & Marks · Timetable · Homework · Communication · Reports · Settings
- **Teacher:** Dashboard · My Classes · Attendance · Marks Entry · Homework · Timetable · Messages · Resources · Profile · Settings
- **Accountant:** Dashboard · Fees & Payments · Invoices · Payments & Receipts · Collection Reports · Student Fee Ledger · Reports & Analytics · Settings
- **Student:** Dashboard · Attendance · Marks & Results · Homework · Timetable · Fees & Payments · Notices · Messages · Profile · Settings
- **Parent:** Dashboard · My Children · Attendance · Marks & Results · Homework · Fees & Payments · Notices · Messages · Profile · Settings
- **Platform Owner:** Dashboard · Schools · Subscriptions & Billing · Platform Analytics · Users Management · Support & Impersonation · Audit Logs · Settings

### 8.5 Design principles (secondary to §8.1–8.4)
- One clear primary action per screen; secondary actions stay visually quiet.
- Skeleton loaders, not spinners, for lists/tables.
- Print stylesheets (`@media print`) for report cards, ID cards, certificates, fee receipts.
- Mobile-first for Student/Parent; Admin/Teacher data-heavy screens can be desktop-first.
- App-wide dark mode is explicitly deferred — match the one light-canvas/navy-sidebar look first.
- Lucide icons only, never mixed with another icon set.
- Build the component layer on shadcn/ui (Radix + Tailwind), restyled with §8.2's tokens.
- **No stock photography or licensed illustration packs** — recreate hero/empty-state imagery as CSS/SVG/Lucide compositions. Avoids licensing risk, keeps the bundle light.

---

## 9. Database Design

### 9.1 Core ER overview
```
roles ── permissions (via role_permissions)   ← GLOBAL, seeded once, not per-school (see note below)

schools (tenant root, has `timezone` §12.7 and `subscriptionStatus`/`trialEndsAt` fields — §13.4's gate checks these, and they exist from Phase 0 even though the full billing UI is Phase 4)
 ├── users (school_id FK, NULLABLE — see note below; roleId FK → the global roles table)
 ├── academic_years (school_id FK)
 ├── subjects (school_id FK)  ← seeded from §3's default list, editable
 ├── classes (school_id FK) ── sections (class_id FK, classTeacherId FK → staff — see note below)
 ├── students (user_id FK, section_id FK)
 ├── student_guardians (student_id FK, parent_user_id FK, relationship)  ← join table, not a single parent_id: real families often need 2+ guardians per student, and one parent commonly has several children
 ├── staff (user_id FK)
 ├── teacher_subjects (staff_id FK, subject_id FK)  ← which subjects a teacher is qualified to teach; added in Phase 1 (Timetable generation and Messaging's teaching-relationship scope both need it — see §9.1's note below), not part of Phase 0's initial schema
 ├── attendance (student_id FK, marked_by FK → staff, date, status)
  ├── fee_structures (class_id FK) ── fee_invoices (student_id FK) ── fee_payments (invoice_id FK, razorpay_order_id + razorpay_payment_id UNIQUE NULLABLE + status — §13.8 idempotency keys, see note below)
  ├── exams (school_id FK) ── exam_subjects (→ subjects) ── marks (student_id FK, exam_subject_id FK)
  ├── exam_remarks (school_id FK, student_id FK, exam_id FK, remark text, generated_by AI|TEACHER, reviewed flag — Phase 3 #18: AI drafts land reviewed=false until a teacher signs off)
 ├── timetable_slots (section_id FK, subject_id FK, teacher_id FK, day, period)
 ├── homework (section_id FK, subject_id FK, teacher_id FK) ── homework_submissions (student_id FK)
 ├── notices (school_id FK, target: school-wide | class | section)
 ├── messages (sender_id FK, receiver_id FK, thread_id)
 ├── documents (owner_id FK, cloudinary_url — stored under a `schools/{schoolId}/...` folder, type)
 ├── auth_tokens (user_id FK, type, token_hash, expires_at, consumed_at)  ← persisted, single-use (§13.3)
 └── audit_logs (school_id FK, actor_id FK, action, entity, before/after JSON)
```

**Eight things easy to get wrong here:**
- **`users.school_id` is nullable, and NULL means exactly one thing: a
  Platform Owner account.** Every other role requires it. Don't make it
  nullable "for flexibility" elsewhere — that's how a tenant boundary
  quietly erodes.
- **Email uniqueness is per-school, not global**: the unique constraint is
  on `(school_id, email)`, not on `email` alone — two different schools
  independently having a teacher with the same email address is normal and
  must be allowed. (Platform Owner rows, with `school_id = NULL`, need
  their own uniqueness check on `email` among null-school_id rows only —
  in practice there will only ever be one or two of these accounts.)
- **`student_guardians` is a join table, not a single `parent_id` column on
  `students`.** A single FK can't represent two parents/guardians for one
  child, or one guardian with children in different sections — both are
  completely normal real-world cases a School ERP has to handle from day
  one, not retrofit later.
- **`schools.slug` must be unique at the database level**, and registration
  (§8.3) needs a collision strategy when two schools derive the same slug
  from a similar name (e.g. two "St. Mary's School"s) — append a short
  suffix and let the admin edit it, don't silently fail or overwrite.
- **`roles`, `permissions`, and `role_permissions` are global tables, not
  tenant-scoped.** Unlike `subjects` (genuinely different per school),
  "Teacher" means the same thing and carries the same permissions on every
  school on the platform — seed this fixed set once, globally, at deploy
  time. Only the *assignment* of a role to a specific user is tenant-scoped,
  via that user's own `school_id`. Don't add `school_id` to these three
  tables "to be safe" — it doesn't add isolation, it just means seeding six
  identical role definitions per school forever.
- **`schools.subscriptionStatus` (e.g. `TRIAL`/`ACTIVE`/`SUSPENDED`) and
  `trialEndsAt` need to exist from Phase 0**, not Phase 4, even though the
  full billing/plan-management *feature* (§7 Phase 4 #24) is genuinely far
  out. `tenantMiddleware`'s subscription gate (§13.4) checks this field
  starting in Phase 0 — every school registration defaults to `TRIAL`,
  with `trialEndsAt` set to 14 days out, matching the "14-day free trial"
  already promised on the pricing page (§8.3) — that promise needs to be
  literally true from the first registration, not just marketing copy.
  Don't wait to add the column until Phase 4; add the field now, build the
  UI to manage it later.
- **`sections.classTeacherId`** is a deliberately lightweight assignment —
  not the same thing as the full `timetable_slots` schedule. Attendance
  (§7 Phase 1 #2) needs "which teacher can mark attendance for this
  section" from the start; the full period-by-period, subject-by-subject
  timetable (§7 Phase 1 #5) is a separate, richer feature built later in
  the same phase. Don't block Attendance on Timetable existing first — set
  the class teacher during school setup (§7 Phase 0), and let Timetable
  layer richer per-subject scheduling on top whenever it's built.
- **`teacher_subjects`** (which subjects a teacher is qualified to teach)
  is what Timetable's generator and Messaging's teaching-relationship
  scope (§13.7) both actually need — and it was missing from this schema
  entirely until it surfaced while writing the Phase 1 build prompts, not
  during schema design itself. Worth being honest about: that's a real
  instance of a gap slipping through review and only showing up once
  someone tried to actually sequence the work — which is exactly why the
  mental-simulation review passes on this plan kept finding things a pure
  read didn't. Add this table in Phase 1 (Chunk 3, alongside Timetable),
  and add it to `SECURITY_PATTERNS.md`'s `TENANT_MODELS` in the same
   commit — don't let it become a fourth instance of that exact list
   missing an entry.
- **`fee_payments.razorpay_order_id / razorpay_payment_id / status`**
  (the §13.8 idempotency keys) were missing from this schema the same way
  `teacher_subjects` was — nothing could actually look a payment up by
  the provider's order ID, which is exactly what §13.8's "look up the
  invoice by the Razorpay order/payment ID" requires the webhook to do.
  Both id columns are UNIQUE NULLABLE (NULL for manual counter payments
  — MySQL allows multiple NULLs, so the counter flow is untouched), and
  the Phase 2 webhook resolves invoice + school through them instead of
  trusting anything embedded in the payload. `status` is PENDING /
  CAPTURED / FAILED / REFUNDED defaulting to CAPTURED (every existing
  row is received money, so the default is truthful for all of them);
  counter payments and confirmed webhooks both land CAPTURED, while
  PENDING/FAILED/REFUNDED belong to the order-attempt and refund
  transitions the Phase 2 webhook owns.

### 9.2 Indexing
Composite `attendance(school_id, section_id, date)`, `students(school_id,
section_id)`, `fee_invoices(student_id, status, due_date)` — `school_id`
always first (left-prefix matching). `EXPLAIN` every list endpoint before
shipping it.

### 9.3 Normalization
Keep `attendance`/`marks` normalized (one row per student per day/subject) —
no denormalized JSON blobs.

---

## 10. API Design (REST)

`/api/v1/schools/:schoolId/...` for tenant-scoped resources — goes through
`tenantMiddleware`. `/api/v1/platform/...` for the Platform Owner — goes
through the separate `platformOnlyMiddleware` instead, never
`tenantMiddleware` (§13.4).

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/auth/register` | School admin self-signup — the one exception to tenant middleware, see §8.3 |
| POST | `/api/v1/auth/login` | Access + refresh JWT (email + password; school slug optional — omitted means Platform Owner, §8.3) |
| POST | `/api/v1/auth/refresh` | Rotate access token |
| GET | `/api/v1/schools/:schoolId/students` | Paginated roster |
| POST | `/api/v1/schools/:schoolId/attendance` | Bulk mark attendance |
| GET | `/api/v1/schools/:schoolId/attendance/summary` | Aggregated % |
| POST | `/api/v1/schools/:schoolId/fees/invoices/:id/pay` | Record payment |
| GET | `/api/v1/schools/:schoolId/exams/:examId/results` | Ranked results (§11) |
| POST | `/api/v1/schools/:schoolId/timetable/generate` | Auto-generate (§11) — must return a partial result + a list of unresolved conflicts if no fully conflict-free solution exists, not crash or hang |
| GET/POST | `/api/v1/schools/:schoolId/notices` | Notices |
| POST | `/api/v1/public/enquiries` | Public admission enquiry — unauthenticated, rate-limited + honeypot (§13.5) |
| GET | `/api/v1/platform/schools` | Platform Owner only — every school, plan, status |
| POST | `/api/v1/platform/schools/:id/suspend` | Platform Owner only — suspend a school (blocks login for its tenant users, §13.4) |
| POST | `/api/v1/payments/webhook` | Razorpay webhook (Phase 2, TEST MODE — §1, §7) — unauthenticated by nature; full security checklist at §13.8 (signature verification, idempotency, server-side amount, never trust the payload's school/invoice ID) |
| WS | `/socket.io` | Chat, live notices — the connection handshake verifies the JWT and derives `school_id` server-side; never trust a client-supplied namespace/room name (§12.5) |

Envelope `{ success, data, error, meta }`; cursor pagination for large lists.

---

## 11. DSA Concepts — Mapped to Real Features

| DSA Concept | Where it's used | Why |
|---|---|---|
| Hash Maps | RBAC permission lookup, session/token blacklist, CSV import dedup | O(1) permission checks |
| Trees (N-ary) | School → Classes → Sections → Students | Natural rollup queries |
| Graph coloring / CSP | Timetable auto-generation | Hardest real feature, genuine differentiator |
| Sorting + Heaps (top-K) | Exam rank / leaderboards | O(n log k) vs full sort |
| Sliding window | Attendance streaks, login rate limiting | Direct fit |
| Prefix sums | Monthly attendance %, running fee totals | O(1) range queries |
| Priority Queue | Fee reminder scheduling, notification queue | Urgency-first processing |
| Trie | Name search-as-you-type | Instant autocomplete |
| LRU Cache | Hot dashboard reads (timetable, roster) | Cuts DB load |
| Union-Find | Dedup parent records on bulk import | Avoids O(n²) comparisons |
| BFS/DFS | Role/permission inheritance if roles become hierarchical | Standard traversal |

Don't hand-roll DSA where a MySQL index already solves it.

---

## 12. System Design Deep Dive

### 12.1 Architecture
```
   Browser ──▶ Next.js (Vercel) ──▶ Express API (Render) ──▶ MySQL (Aiven)
                                          │
              Cloudinary / SMTP / Groq (AI, free) / Razorpay (test mode, §13.8)
                                          │
                          (stubbed until enabled: SMS/WhatsApp gateway — §1)
```

### 12.2 Request flow (mark attendance)
`authMiddleware` → `tenantMiddleware` (re-derives `school_id` from JWT) →
`rbacMiddleware` → Zod validation → bulk `INSERT ... ON DUPLICATE KEY UPDATE`
→ Socket.io emit + enqueue absentee alert → `{ success: true, data: { marked: 42 } }`.

### 12.3 Caching
In-memory LRU for read-heavy rarely-changing data — today's timetable,
roster, fee structure, **and dashboard KPI aggregates specifically (total
students, today's attendance %, this month's fee collection)**, since those
run a `COUNT`/`SUM` across potentially thousands of rows on every dashboard
load otherwise; cache key always includes `school_id`; invalidate on write.
Redis only once this actually becomes a bottleneck, not by default.

**Use one shared Prisma client instance for the whole Express process**
(the extensions in `SECURITY_PATTERNS.md` wrap it per-request, they don't
create new connections) — Aiven's free MySQL tier caps concurrent
connections, and a `new PrismaClient()` per request exhausts that limit
fast. This is already how the reference code is written; don't "fix" it
into per-request client creation.

### 12.4 Background jobs
`node-cron` for scheduled jobs at MVP scale — e.g. fee reminders, and
**checking for expired subscriptions and setting a school's status to
suspended (§13.4's subscription gate; §16)**. Both need to run against
**each school's own timezone (§12.7)**, not server UTC — "daily at 9am"
should mean 9am for that school, not 9am UTC.

### 12.5 Realtime
Socket.io namespaced per school (`/school-:schoolId`) — **the namespace
string alone is not a security boundary.** The server verifies the JWT
during the connection handshake and derives `school_id` from it, the same
as `tenantMiddleware` does for HTTP; it never trusts a client-supplied
namespace or room name to decide which school's messages a socket can see.
Common real-time chat bug to avoid: holding "the current recipient" in a
plain variable inside a component goes stale across re-renders — use a ref
or your framework's persistent-reference equivalent. **The client needs
visible reconnection handling** ("Reconnecting…", not a silently dead chat)
— Render's free tier cold-starts the API after inactivity, which drops the
socket, and that's a normal, expected event on this hosting tier, not an
edge case.

### 12.6 Per-school theming
`--school-primary` / `--school-logo-url` CSS variables injected at runtime
from school settings.

### 12.7 Timezone handling
Since §3 positions this as usable by any English-medium school anywhere,
don't hardcode a timezone. Store every timestamp in UTC in the database;
each school has a `timezone` field (defaults to `Asia/Kolkata` for your
initial market, editable in school setup); business-day boundaries —
"today's attendance," a fee's due date, an exam's scheduled day — are
computed by converting UTC to that school's timezone, not the server's.

---

## 13. Security & Error Handling

### 13.1 Input validation
Zod at every route boundary, before business logic. Sanitize string inputs against stored XSS.

### 13.2 Global error handling
`catchAsync` wrapper; centralized `errorMiddleware` distinguishing
operational vs programming errors; consistent
`{ success: false, error: { code, message } }`; log 5xx with context
(Pino/Winston); custom error classes; React error boundaries on the frontend.

### 13.3 Auth security
- Access token 15m, refresh 7d as httpOnly cookie, refresh rotation.
- Password-reset/email-verification tokens go in a persisted `auth_tokens`
  table from day one — never an in-memory `Map`, which loses every token on
  restart.
- **Tokens are single-use:** mark `consumed_at` (or delete the row) the
  moment a reset/verification token is used, and reject any further attempt
  to use the same token — otherwise a leaked reset link (email forwarding,
  browser history, a shared inbox) stays valid indefinitely.
- Any "verify"/"confirm" endpoint that matches a token MUST write the
  resulting state change to the database, with a test asserting the DB field
  actually changed, not just that the endpoint returned 200.
- bcrypt cost ≥ 10, rate-limit login/reset endpoints (sliding window, §11).
- **Bulk-imported accounts (CSV import, §7 Phase 0) never get a shared
  default password.** Generate a random temporary password per account (or
  skip the password entirely) and send a "set your password" link through
  the same single-use `auth_tokens` flow as a normal password reset — a
  known shared password across dozens of imported accounts is a real,
  common School-ERP vulnerability, not a theoretical one.

### 13.4 Tenant isolation — build before Phase 1, not retrofitted later
`tenantMiddleware` re-derives `school_id` from the JWT, never from client
input, and a Prisma extension auto-appends `where: { school_id }` to every
tenant-scoped model query. Reference implementation in
`SECURITY_PATTERNS.md` — **adapt and validate it against your actual schema
before trusting it (see `AGENT_START_HERE.md` step 0).** Add every new
tenant-scoped Prisma model to the scoping list in the same commit you add it
to `schema.prisma`.

**Two deliberate exceptions, both already covered above but easy to trip
over while implementing:**
- **`POST /auth/register`** doesn't go through `tenantMiddleware` — there's
  no `school_id` to derive yet, because this request is what creates the
  school. It uses the raw, unscoped Prisma client for this one write only
  (§8.3).
- **Everything under `/api/v1/platform/...`** doesn't go through
  `tenantMiddleware` either — it goes through `platformOnlyMiddleware`
  instead, which checks `role === 'PLATFORM_OWNER'` and does not require or
  derive a `school_id` at all, since the Platform Owner's queries are
  legitimately cross-tenant (§5, §10).

**A third thing, not an exception but worth stating explicitly so nobody
"completes the symmetry" by accident: there is no public endpoint that
creates a Platform Owner account, ever.** `POST /auth/register` creates a
school + a School Admin — it's tempting to assume there should be an
equivalent public flow for Platform Owner, since the login form already
treats "no slug" as that path (§8.3). There isn't one, and there must not
be one — a public "become Platform Owner" endpoint would let anyone grant
themselves access to every school on the platform. Platform Owner accounts
are created exactly two ways: the seed script (`DEMO_DATA.md`, local/demo
only) or a direct, manual, out-of-band operation on the production database
(a one-off script you run yourself, not a route the app exposes) — never
through a request the internet can reach.

**Subscription gate:** `tenantMiddleware`, after deriving `school_id`, also
checks that school's subscription status. A suspended school (§16
non-payment) blocks login and all API access for its tenant users with a
clear "contact your school administrator" message — data is retained, not
deleted, matching §16's auto-downgrade policy. This check does not apply to
`platformOnlyMiddleware` routes, since a Platform Owner needs to be able to
reactivate a suspended school.

### 13.5 General hardening
`helmet`; CORS locked to real origins; parameterized queries only; file
upload MIME/size whitelist; uploads stored under a `schools/{schoolId}/...`
Cloudinary folder path with non-guessable public IDs, never a predictable
sequential name (§9.1); `.env` never committed; `/health` endpoint;
graceful shutdown on `SIGTERM`; no stack traces or SQL errors leaked to the
client. The public admission-enquiry endpoint (§10) needs rate limiting +
a honeypot field — it's the one unauthenticated form in the app and the
default spam target.

### 13.6 Known pitfalls to avoid (learned from an earlier attempt at this project)
- A route declared after `export default router` is dead code — declare all routes before the export.
- A router mounted twice can expose admin endpoints publicly — mount each router exactly once; test every admin endpoint unauthenticated, expect 401/403.
- A component that claims to support sort/pagination but doesn't implement either is a bug waiting to be found — implement it or don't claim it in the UI.
- Prisma `Decimal` fields arrive as strings over JSON — coerce with `Number(...)` before arithmetic, or totals silently concatenate instead of summing.

### 13.7 Messaging access constraints — this product's users include children
The 1:1 chat (§7 Phase 1 #8) needs access rules beyond ordinary tenant/RBAC
scoping, because a meaningful share of the accounts on this platform belong
to minors:
- **No open Student-to-Student messaging.** The messaging feature exists for
  Teacher↔Parent and Teacher↔Student academic communication — not a general
  chat app. Don't build a "message any student" affordance.
- **Teacher↔Student messaging is scoped to an actual teaching relationship**
  (derived from `timetable_slots` — a teacher can message a student only in
  a class/section they actually teach), not "any teacher, any student in
  the school."
- **School Admin can view any conversation in their school** (an oversight
  capability, not a participant one) — this is standard practice for
  ed-tech products with minors as users and is worth stating explicitly in
  the school's terms so it's not a surprise to parents or staff.

### 13.8 Payment security — Razorpay, genuinely built, TEST MODE only (§1, §7 Phase 2 #12)
This is a real integration, not a fake mockup — real webhooks, real
signature verification, a real checkout flow. The one thing that's
deliberately not real is the money: this project runs on Razorpay **test
keys only**, permanently, by design. That doesn't make the security
checklist below optional — a test-mode integration built carelessly still
teaches the agent (and proves to anyone reviewing this project) nothing
about doing it correctly. Build it exactly as if real money were moving
through it, because the whole point of doing this properly here is that
the same code would be production-correct if it ever needed to be.

**Test mode, not real, and that boundary matters:**
- **Generate Razorpay TEST API keys** — these are free, and unlike LIVE
  keys don't require business/website verification, which fits a demo
  project that has no real registered business behind it.
- **Never add Razorpay LIVE keys to this project, ever, for any reason.**
  If you (the founder) have live keys from a separate, real, already-live
  project, that is a **different project with different credentials** —
  don't reuse or paste them here under any circumstance, including "just to
  test something quickly." Mixing them is a real financial-security mistake,
  not a hypothetical one. If a live key ever ends up in this project's
  files or env vars by accident, treat it as a security incident: stop,
  flag it clearly to the founder, rotate/revoke that key, don't quietly
  proceed as if nothing happened.
- **Use Razorpay's standard published test cards** to build and demo the
  full flow end to end — e.g. card number `4111 1111 1111 1111`, any future
  expiry date, any 3-digit CVV, which simulates a successful payment
  without touching a real bank. This is what makes "click Pay Fee and watch
  it actually work" possible in a demo/interview walkthrough.
- **Show a visible "TEST MODE" indicator in the payment UI** — not because
  test/live risk confusion here (there are no live keys to confuse it
  with), but because anyone using or reviewing this project should never
  wonder whether a payment they just made was real.

**The security checklist — build this correctly regardless of test/live:**
- **Never trust a client-supplied amount.** The frontend sends an invoice
  ID, never an amount — the server looks up the real invoice, recalculates
  the amount itself, and creates the Razorpay order with that
  server-computed number. A tampered client request should be structurally
  incapable of paying less than what's actually owed.
- **The payment-initiation endpoint needs self-scope, not just tenant
  scope.** Tenant scoping alone only proves the invoice belongs to the
  right *school* — it doesn't stop a parent at that same school from
  initiating payment on a different family's invoice. Run the same
  Student/Parent self-scope check (§5, `SECURITY_PATTERNS.md` §3) here
  that already applies to reading fee data — a parent can only pay
  invoices for their own linked children.
- **Verify the webhook signature** (Razorpay's HMAC signature header,
  checked against `RAZORPAY_WEBHOOK_SECRET`) before trusting any webhook
  payload at all — an unverified webhook is an open door to marking
  arbitrary invoices paid. Test-mode webhooks carry the same signature
  scheme as live ones — verifying it properly here is exactly what proves
  the integration is correct, not a formality to skip because it's "just
  test mode."
- **Webhook idempotency.** Payment gateways redeliver webhooks — the same
  event can arrive more than once. Use the Razorpay payment/order ID as an
  idempotency key so a redelivered webhook doesn't record the same payment
  twice.
- **Look up the invoice by the Razorpay order/payment ID**, never by
  trusting a `school_id` or `invoiceId` embedded in the webhook payload
  itself — the payload identifies the transaction, your own database is
  what identifies which invoice and which school it belongs to.
- **PCI scope stays minimal by design, keep it that way:** Razorpay hosts
  the actual card-entry checkout — raw card numbers should never touch your
  server or database, test mode or not. Don't build a custom card-input
  form that would change this.
- **Plan for refunds now, even if built later.** A payment feature
  eventually needs a refund path (full or partial) — it doesn't have to
  ship in the first pass, but the invoice/payment data model (§9.1) should
  be able to represent a refunded state without a schema rework.

---

## 14. Non-Functional Requirements
- Paginate everything by default; target <300ms for list endpoints at 1,000 students/school.
- Accessibility: semantic HTML, keyboard nav, visible focus states, contrast-safe even against a school's custom brand color.
- No i18n system — English-only is a deliberate product decision (§3).
- PWA/offline resilience is Phase 3, not required for MVP.

## 15. Testing Strategy
- Unit tests (Jest/Vitest): grade calc, attendance %, timetable conflict detection, top-K ranking.
- Integration tests against a test MySQL DB.
- E2E smoke test (Playwright): login → mark attendance → generate report card.
- `npm audit --audit-level=high` as a CI gate — fails the build on high/critical vulnerabilities.
- A tenant-isolation regression test suite (attempts cross-tenant reads/writes and asserts rejection) — passing **before** Phase 1 work begins.

## 16. Monetization
| Plan | Price | Limit | Support |
|---|---|---|---|
| Basic | ₹2,999/mo | Up to 500 students | Email |
| Standard (Most Popular) | ₹5,999/mo | Up to 1,500 students | Priority |
| Premium | ₹9,999/mo | Unlimited students | 24/7 |

14-day free trial, no setup fee, cancel anytime. GST-compliant invoicing.
Auto-downgrade (not delete) on non-payment. India-market pricing/currency —
see §3 for why this doesn't conflict with the product being internationally usable.

## 17. Roadmap
- **Weeks 1–2 — Phase 0:** multi-tenancy, auth, RBAC, row-level self-scoping with regression tests, hardening. Nothing else starts until this is green (§6).
- **Weeks 3–8 — Phase 1:** MVP modules + all six dashboards + public site, built against §8 from the first commit. Deploy. Pilot with one real school.
- **Weeks 9–12 — Phase 2:** Razorpay built for real on TEST keys per the §13.8 checklist; SMS/WhatsApp stays behind a stub until you decide to pay for a gateway (§1); library/transport/payroll/CRM/certificates.
- **Weeks 13+ — Phase 3–4:** AI features built for real on Groq's free tier (§1, §2), analytics, subscription & billing, data export, PWA.

## 18. Known Priority Gaps to Plan For
| Gap | Why it matters |
|---|---|
| SMS/WhatsApp real gateway | Biggest sales lever for Indian schools — but paid, so deliberately deferred per §1 |
| Subscription & billing | You can't actually charge schools without it — build in Phase 4 |
| DPDP Act compliance (and equivalents wherever a customer school actually operates, given §3's international positioning) | Real legal review before onboarding a real school's student data, not just a policy page — start with India since that's the first market, but don't assume it's the only regime that will ever apply |
| Dependency vulnerabilities | The `npm audit` CI gate (§15) exists specifically so these don't sit unresolved |

---

## 19. Repo Structure & Companion Files
```
studyfy/
├── apps/
│   ├── web/ (Next.js, TS)
│   │   ├── app/  components/ui/ (shadcn)  lib/  styles/ (tokens from §8.2)
│   └── api/ (Express, TS)
│       ├── src/modules/  middleware/ (auth, tenant, platform-only, rbac, selfscope, error)  lib/  server.ts
│       └── tests/
├── packages/shared-types/
├── prisma/ (schema.prisma, migrations, seed.ts ← §7 Phase 0's demo-data script)
├── docs/designs/
│   ├── studyfy-dashboards-ref-a.png
│   ├── studyfy-dashboards-ref-b.png
│   ├── studyfy-dashboards-ref-c.png
│   ├── studyfy-dashboards-ref-d.png
│   └── studyfy-public-site-and-auth-ref.png
├── .github/workflows/ci.yml
├── .env.example
├── CURRENT_TASK.md            ← read this FIRST, every session — session handoff
├── AGENT_START_HERE.md        ← read this second
├── SECURITY_PATTERNS.md       ← reference code for §13.4/§5's tenant + self-scope middleware
├── DEMO_DATA.md                ← the two reference schools' full roster (§7)
├── STUDYFY_PROJECT_SPEC.md   ← this file
├── RULES.md                  ← agent operating rules
├── STATUS.md                 ← living tracker, Definition-of-Done per RULES.md
└── BUGSFIX.md                ← living bug log, seeded with §13.6's pitfalls
```

## 20. Environment Variables
```
# API — free, needed from Phase 0/1
DATABASE_URL=mysql://user:pass@host:port/studyfy
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
CLOUDINARY_URL=
FRONTEND_ORIGIN=
SMTP_HOST= / SMTP_USER= / SMTP_PASS=      # free — real notification channel, §7 Phase 1

# AI (Phase 3) — free, build for real on Groq (§1, §2)
GROQ_API_KEY=
OPENAI_API_KEY=       # optional future upgrade only — leave blank, never required

# Razorpay (Phase 2) — TEST MODE ONLY, permanently, by design (§1, §13.8).
# These are Razorpay TEST keys — free to generate, no real money.
# NEVER put LIVE keys here, including from any other real/live project:
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# The one deliberately deferred item — leave blank until you decide to pay
# for a real gateway (§1); the feature stays behind a stub without this:
SMS_WHATSAPP_API_KEY=

REDIS_URL=            # later, only once actually needed

# Web
NEXT_PUBLIC_API_URL=
```

## 21. Open Decisions
1. ORM: **Resolved — Prisma.**
2. Brand color + font: **Resolved — blue/navy per §8.2.**
3. Login screen: **Resolved — no role tabs (§8.1), school slug + email + password.**
4. Landing page trust signals: **Resolved — no fabricated stats until real ones exist (§8.1).**
5. Mobile: **Resolved — responsive web only, no native app, no store badges (§8.1).**
6. SMS/WhatsApp provider choice: still open — pick one when you're ready to pay for it (§1). This is the only remaining genuinely deferred item.
7. AI provider: **Resolved — Groq, free tier, default (§1, §2).** OpenAI is an optional future upgrade, never required.
8. Razorpay: **Resolved — build it for real, TEST MODE only, permanently (§1, §13.8).** Live mode is a separate future decision, not part of this build.
9. Whether "Studyfy" is final for domain/trademark purposes — still your call.

---
*End of spec. Living document — update it as decisions change.*
