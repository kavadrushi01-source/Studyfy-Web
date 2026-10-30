# Demo Data — Two Reference Schools

> Referenced from `STUDYFY_PROJECT_SPEC.md` §7 ("Demo Data — Two Reference
> Schools") and built by `prisma/seed.ts` in Phase 0. Use these exact names
> and structure — consistency here is what makes the two schools reusable
> across every screenshot, demo, and interview walkthrough, instead of
> looking different every time the seed script runs.

**Why two schools, not one:** a single seeded school can't demonstrate
tenant isolation — the single most important thing this project is actually
built around. Two independent schools, correctly kept separate by every
query, is the real proof: log in as School of Science's admin and
Ramakrishna School's data simply isn't there. That's a strong, concrete
thing to show in a portfolio walkthrough or an interview, not just claim.

---

## School 1 — School of Science (SOS)

| Field | Value |
|---|---|
| Name | School of Science |
| Slug | `school-of-science` |
| Character | Modern, co-ed, STEM-focused secondary school |
| City / State | Ahmedabad, Gujarat, India |
| Timezone | `Asia/Kolkata` |
| Subscription status | `ACTIVE` (not `TRIAL`) — a demo school showing a "trial ending in 3 days" countdown is a confusing, wrong impression for a portfolio walkthrough |
| Plan (from Phase 4, §16.1) | `PREMIUM`, and `isDemo = true` (§13.11) — shows every module, including the Phase 3 ones |
| Brand color (§8.2/§12.6 theming) | Teal `#0D9488` |
| Subjects | Full §3 default list (Mathematics, Physics, Biology, Chemistry, Earth Science, Environmental Science, Astronomy/Space Science, English, Computer Science) — thematically fits a "Science" school well |
| Classes | Grade 9 (Sections A, B), Grade 10 (Section A) |

**Admin:** Dr. Kavita Rao (Principal)

**Teachers:**
| Name | Subject(s) |
|---|---|
| Arjun Mehta | Mathematics |
| Sneha Iyer | Physics, Chemistry |
| Rohit Deshmukh | Biology, Earth Science, Environmental Science, Astronomy/Space Science |
| Fatima Shaikh | English |
| Karan Mistry | Computer Science |

**Accountant:** Vikram Solanki

**Librarian:** Lata Nair (library desk: catalog, issue/return)

**Transport Manager:** Ravi Nair (transport desk: routes, fleet, riders)

**Students (8) and guardians:**
| Student | Section | Guardian(s) |
|---|---|---|
| Aditya Sharma | 9-A | Suresh Sharma (father) **and** Kavita Sharma (mother) — the two-guardian case, exercises `student_guardians` (§9.1) |
| Ishita Choudhary | 9-A | Ramesh Choudhary |
| Yash Gupta | 9-A | Anita Gupta |
| Ananya Joshi | 9-B | Prakash Joshi |
| Rahul Verma | 9-B | Sunita Verma |
| Priya Patel | 10-A | Nilesh Patel |
| Aarav Nair | 10-A | Deepa Nair |
| Meera Pillai | 10-A | Suresh Pillai |

---

## School 2 — Ramakrishna School

| Field | Value |
|---|---|
| Name | Ramakrishna School |
| Slug | `ramakrishna-school` |
| Character | Established, traditional, values-oriented secondary school |
| City / State | Rajkot, Gujarat, India |
| Timezone | `Asia/Kolkata` |
| Subscription status | `ACTIVE` (not `TRIAL`) — same reasoning as SOS |
| Plan (from Phase 4, §16.1) | `STANDARD`, and `isDemo = true` (§13.11) — deliberately a tier below SOS, so plan gating (locked Phase 3 features with an upgrade prompt) is visible in a side-by-side demo |
| Brand color (§8.2/§12.6 theming) | Deep maroon `#7F1D1D` — deliberately distinct from SOS's teal, so the two schools are visually unmistakable in any side-by-side demo |
| Subjects | Same §3 default list as SOS — same curriculum, different institution, proving the subject list is genuinely per-school seeded data, not hardcoded |
| Classes | Grade 9 (Section A), Grade 10 (Sections A, B) |

**Admin:** S. Venkataraman (Principal)

**Teachers:**
| Name | Subject(s) |
|---|---|
| Anjali Kulkarni | Mathematics |
| Deepak Chandran | Physics, Chemistry |
| Radha Krishnan | Biology, Earth Science, Environmental Science, Astronomy/Space Science |
| Michael D'Souza | English |
| Priyanka Bose | Computer Science |

**Accountant:** Ramesh Iyer

**Librarian:** Lata Nair (library desk: catalog, issue/return)

**Transport Manager:** Ravi Nair (transport desk: routes, fleet, riders)

**Students (8) and guardians:**
| Student | Section | Guardian(s) |
|---|---|---|
| Krishna Murthy | 9-A | Sunita Murthy |
| Sanjana Rao | 9-A | Geeta Rao |
| Vivek Pillai | 9-A | Anand Pillai |
| Divya Menon | 10-A | Ravi Menon |
| Arjun Reddy | 10-A | Lakshmi Reddy |
| Lakshmi Narayan | 10-B | Suresh Narayan |
| Rohan Kamath | 10-B | Meena Kamath |
| Neha Bhatt | 10-B | Ashok Bhatt |

---

## Platform Owner (shared, not per-school)

One account, `school_id IS NULL` per spec §9.1's rule: **Admin User**
(email whatever the seed script chooses, e.g. `owner@studyfy.dev`) — this
is the account that logs in with no school slug (§8.3) and can see both
schools from `/api/v1/platform/...` routes. Per §13.4's rule: this account
is created **only** by the seed script itself, never through any public
endpoint — the seed script running locally is exactly the "direct,
out-of-band operation" that rule allows.

## Login credentials for every seeded account

Every synthetic demo-school account created by `prisma/seed.ts` — teachers,
students, parents, accountants, and both school admins — uses the demo
password, resolved as follows (§13.11):

- `DEMO_PASSWORD` from the environment always wins (production rotation,
  CI, local experiments).
- The `Demo@1234` fallback below applies ONLY to a local database seeded
  with `NODE_ENV=development`. Anything else without `DEMO_PASSWORD` —
  production, a remote DB, CI — refuses to seed rather than writing
  publicly-documented credentials onto a reachable database.

The demo password is `Demo@1234`. On the live site this password works only
for the synthetic demo-school accounts; production sessions for either demo
school last 30 minutes, cannot be refreshed, and are read-only. New school
registrations always choose their own admin password and are unaffected.

The seeded Platform Owner is a separate account (`owner@studyfy.dev`) with a
private `OWNER_PASSWORD` of at least 16 characters. Never set it to the public
demo password. New production owner creation fails closed unless that private
environment variable is configured.

Live demo admin credentials:

| School | Slug | Email | Password |
|---|---|---|---|
| School of Science | `school-of-science` | `kavita.rao@schoolofscience.demo` | `Demo@1234` |
| Ramakrishna School | `ramakrishna-school` | `s.venkataraman@ramakrishnaschool.demo` | `Demo@1234` |

**This is deliberately different from §13.3's rule for real bulk-imported
accounts** (random per-account password, single-use reset link, never a
shared default) — that rule exists to protect real students' real accounts
at a real school. This is fictional seed data, and a known password makes
the public walkthrough easy. Production API sessions for demo schools are
read-only and expire after 30 minutes. Use unique passwords for real users.
The local development default is also convenient: log in as each role to
verify dashboards, tenant isolation, and self-scoping by hand (per
`AGENT_START_HERE.md`'s final human-verification step). Don't apply
§13.3's random-password logic to the seed script — it would make the demo
data unusable for its actual purpose. Just as clearly: never reuse this
pattern for a real bulk import of a real school's real students — that's
exactly the shared-default-password mistake §13.3 exists to prevent.

The public demo password is intentionally published for sample accounts only.
The Platform Owner password must remain private and is never shared with demo
users. Existing accounts keep their current hashes until the rotation command
below is run; changing the Render environment variable alone does not change
their passwords.

**Updating live demo credentials** (no school data touched): set `DEMO_PASSWORD`
to `Demo@1234` and `OWNER_PASSWORD` to a separate private random password of at
least 16 characters in the Render environment, then run
`npm run db:reset-demo-passwords --workspace=@studyfy/api` with `DATABASE_URL`
pointing at the live database and both variables present in the shell
environment. On Render, run this command from the service shell after the code
deploys. It rewrites only `passwordHash` rows inside `isDemo` schools and the
seeded owner's hash using the separate private password. Verify demo logins
work and the owner password is not the public one. Never share
`OWNER_PASSWORD` or paste it into chat.

**Subscription demo data (from Phase 4):** seed two or three paid subscription
invoices per demo school with payment method `TEST`/`MANUAL`, visibly labelled
as test payments, so the Platform Owner dashboard's revenue cards aren't empty
in a walkthrough. It's fictional seed data kept to dev/demo environments, same
rule as everything else in this file — never presented as real revenue.

---

## Sample transactional data (both schools, same pattern)

Don't hand-write literal rows for this in the seed script's design — follow
this pattern and let the script generate realistic values:

- **Attendance:** the last ~15 school days for every student. Mostly
  Present, with a few Absent/Late scattered per student (aim for roughly
  85–98% attendance per student, varied, not uniform) — real enough that
  the attendance-% dashboards and charts show actual variation, not a flat
  100% or 0%.
- **Fees:** one invoice per student for the current term. Distribute
  statuses on purpose so the `StatusPill` variety from the reference boards
  actually shows: most **Paid**, one or two **Pending**, at least one
  **Overdue** per school. Once Razorpay (§13.8) is built in Phase 2, the
  **Pending** invoices are exactly what you'd click "Pay Fee" on in a demo
  — use Razorpay's standard test card (`4111 1111 1111 1111`, any future
  expiry, any CVV) to walk through a real, working payment end to end,
  with zero real money involved.
- **Exams:** one completed "Unit Test 1" per school, marks entered for
  every student across 2–3 subjects, with realistically varied scores (not
  all identical) so rank calculation and grade letters (§11's DSA — top-K,
  heaps) have real data to compute against.
- **Homework:** two assignments per class — one already graded with most
  students' submissions recorded, one still open/pending, so both states
  are visible in the UI.
- **Notices:** two or three recent notices per school — e.g. a
  parent-teacher meeting date, a half-day announcement, a science
  exhibition (SOS) or annual day (Ramakrishna) — school-wide or
  class-scoped, matching §7 Phase 1 item 7.

## A note on realism vs. fabrication (consistent with §8.1)

This is seed data for local development and demos — it's fine and expected
to be fictional. The distinction that matters (same one §8.1 draws for the
public landing page) is: this data is clearly demo/seed data used to
populate a working dev environment, not something presented as real usage
statistics or real customer claims anywhere in the actual product UI (no
"School of Science says..." testimonial, no counting these two schools
toward a public "500+ schools" style claim). Keep it in `prisma/seed.ts`
and local/demo environments only.
