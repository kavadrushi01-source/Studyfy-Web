# Layer 2 Report — live deployed-site verification

**Status:** COMPLETE with one open item (web CSP) and two accepted env gaps.
**Verdict:** **GO** for demo/portfolio use. **CONDITIONAL** for real payments until `PLATFORM_GSTIN` / `PLATFORM_STATE` are set.
**Test window:** 2026-10-19 · **Code under test:** `da61f67` (404 fix) + `bb3f7f5` (web headers), both deployed and re-verified live.

## 1. Environment under test

| | |
|---|---|
| Web | `https://studyfy-web.vercel.app` (Vercel) |
| API | `https://studyfy-api.onrender.com` (Render free tier) |
| DB | Aiven MySQL, 45/45 migrations applied, 0 unfinished |
| `environment` | `production` |
| Razorpay | `TEST` mode confirmed (`rzp_test_…`) — no live money path exercised |
| Demo schools | `school-of-science` (PREMIUM), `ramakrishna-school` (STANDARD) |

Credentials, tokens, and the temporary test-school password are **not** in this file. They lived only in gitignored local notes, all deleted at cleanup.

## 2. Budget used (hard caps)

| Budget | Cap | Used |
|---|---|---|
| Emails | 15 | 3 |
| AI (Groq) calls | 10 | 1 |
| Uploads | 10 | 3 |
| Test payments | 10 | 1 (order only, never captured) |
| Exports | 2 | 1 |
| Failed logins | 15 | ~8 (all from the pre-existing password blocker) |
| Concurrent requests | 20 | 20 (exactly at cap) |

## 3. Blockers found and resolved

The deployment was **not** in the state Layer 1 left off in. Four blockers, all found by inspecting the live database rather than trusting the dashboards.

### B1 — Demo password hashes never rotated (RESOLVED)
`DEMO_PASSWORD` was set on Render and the service redeployed, but that only affects **seed** scripts. Login compares the stored bcrypt hash, so every demo login still returned 401, then 429 after retries.
**Fix:** ran the correct rotation entry point against production —
`npm run db:reset-demo-passwords --workspace=@studyfy/api` (`Reset 30 demo password(s)`). SOS admin and the platform owner now authenticate.
**Note for the founder:** re-running this is required whenever `DEMO_PASSWORD` changes on the host; setting the env var alone does nothing.

### B2 — Ramakrishna School did not exist in production (RESOLVED)
Only `school-of-science` was present; all 8 Ramakrishna logins returned 401. Production had been seeded before the second school shipped.
**Fix:** `npm run db:seed` against production (idempotent, demo-scoped, refuses to run without `DEMO_PASSWORD` outside local dev). Both schools now seed.

### B3 — LIBRARIAN and TRANSPORT_MANAGER logins missing (RESOLVED)
The seed adds these two staff accounts per school; production predated them. SOS role counts were `STUDENT 12, PARENT 11, TEACHER 5, ADMIN 1, ACCOUNTANT 1` — no librarian, no transport manager.
**Fix:** same re-seed. All 16 demo accounts across both schools now authenticate (200).

### B4 — Production was 4 migrations behind (RESOLVED)
`prod = 42`, `local = 46`. The missing `subscription_invoices.plan` column is **written by current code**, so subscription invoice issuance was failing live. Two unique indexes were also absent, leaving no DB backstop against duplicate fee invoices per student and double-booked teachers.
**Fix:** duplicate check first (0 conflicting groups in 17 invoices / 60 timetable slots), then `prisma migrate deploy`. Applied:
- `20261016050321_subscription_invoice_plan` (adds `plan`)
- `20261016111500_fee_invoice_structure_student_unique`
- `20261016113000_timetable_slot_teacher_unique`

The new index was confirmed working: a second `generate` call returned `skipped: [{reason: "Already has a PAID invoice for this structure."}]` instead of double-billing.

## 4. Findings

| ID | Sev | Area | Finding | Disposition |
|---|---|---|---|---|
| F1 | **S2** | API contract | Unmatched routes returned Express's built-in **HTML 404**, while every other error returns `{success, data, error, meta}`. A client calling `res.json()` on a typo'd/retired endpoint threw a parse error instead of reading `error.code`. Live: `GET /api/v1/schools/<id>/definitely-not-a-route` → `404 text/html`. | **Fixed** `da61f67` — terminal 404 handler returning the envelope; deliberately does not echo the path (attacker-controlled string reflected into HTML). Regression test `apps/api/tests/not-found-envelope.test.ts`. Re-verified live: `404 application/json` + `{"code":"NOT_FOUND"}`. BUGSFIX 81. |
| F2 | **S3** | Web hardening | The Vercel frontend served only its default HSTS — no CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, or `Permissions-Policy` — while the API sets all of them. | **Fixed** `bb3f7f5` — four low-risk headers via `next.config.js` `headers()`. **CSP deliberately omitted** (Next.js inline hydration scripts); open item, see §8. |
| F3 | **S2** | Data hygiene | Production held **11 non-demo schools** (9 e2e leftovers from 2026-10-18 plus 2 test schools) — the e2e suite had been pointed at the live database. | **Resolved** — all 11 deleted. |
| F4 | **S2** | Referential integrity | `users.school_id` is `ON DELETE SET NULL`, so deleting a school **orphans its admins into `school_id IS NULL` accounts**. Login treats a missing slug as a platform-level lookup (`auth.service.ts:233`), so the 9 orphaned e2e admins became authenticatable platform accounts. Contained in practice (tenant middleware rejects `schoolId = null` at `tenant.ts:24`, and they hold no `platform.*` keys), but it is a latent privilege-escalation path. | **Partially resolved** — the 9 orphans are deleted. The schema issue itself is **unfixed**; see §8. |
| F5 | **S3** | Upload validation | Declared MIME is cross-checked against the file extension, but neither is checked against actual content — PNG bytes declared as `application/pdf` are accepted (verified live, 201). | Reported. Low impact (Cloudinary stores inert bytes); needs magic-byte sniffing. |
| F6 | **S3** | Data hygiene | SOS demo school carried walkthrough pollution: 4 `@example.com` students, 9 junk fee structures (`LIVE Walkthrough …`), **113** stale PENDING Razorpay payment intents, 7 stray invoices. | **Resolved** — SOS reset to the deterministic seed state (8 students, 2 `Term 1 Tuition` structures, 0 test rows, 0 stale intents). |
| F7 | **S5** | Config | `PLATFORM_GSTIN` and `PLATFORM_STATE` are unset (`/api/v1/platform/settings` → `gstinConfigured: false`, `platformStateConfigured: false`). GST invoices will lack a GSTIN and place-of-supply. | Founder action — §7. |

**No S1 findings.** No secret leakage, no auth bypass, no cross-tenant read.

## 5. Test results

### Authentication & authorization — PASS
16/16 demo accounts log in (both schools × ADMIN, TEACHER, ACCOUNTANT, LIBRARIAN, TRANSPORT_MANAGER, STUDENT, PARENT, plus PLATFORM_OWNER).

**Row scope is correct** — status codes alone would have hidden this, because STUDENT/PARENT/ACCOUNTANT all legitimately hold `students.read`:
- ADMIN sees all 12 (now 8) students; ACCOUNTANT sees all.
- TEACHER sees **4** (section-scoped).
- PARENT sees **1** — only their linked child. STUDENT sees **1** — only self.

**Tenant isolation is airtight:** all five SOS roles requesting another school's data get `403 TENANT_MISMATCH`. Foreign object IDs return `404 NOT_FOUND` for staff, `403 FORBIDDEN` for self-scoped roles. Unauthenticated → 401; tampered and `alg=none` tokens → 401.

### Session / cookie / refresh / logout — 18/18 PASS
Refresh cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/api/v1/auth` (so it is not sent to school routes). Refresh **rotates**; replaying the old cookie is rejected (`403`). Logout revokes (`401` after). Access-token `/auth/me` behaves correctly with no/tampered/forged tokens.

### Plan gating — 11/11 PASS
SOS (PREMIUM) reaches every gated route. RK (STANDARD) is blocked with `403 PLAN_UPGRADE_REQUIRED` on all four Phase 3 routes (`inventory`, `biometric`, `analytics/overview`, `attendance/anomalies`) while Phase 2 routes stay open — exactly the intended side-by-side demo.

### Integrations
- **Upload / Cloudinary** — PNG → `201`, hosted on `res.cloudinary.com`. `6 MB` rejected `413 FILE_TOO_LARGE`. `.txt` rejected `415 UNSUPPORTED_FILE_TYPE`. Teacher → `403` (no `documents.write`).
- **AI / Groq** — `attendance/anomalies` → `200`, `summaryStatus: "ok"`.
- **Email** — `forgot-password` returns `200 {"received":true}` for a valid user, an unknown email, **and** an unknown school: no account enumeration.
- **Payment (Razorpay test)** — real order created (`order_…`, amount ₹13,800 matching the outstanding balance). It records a **PENDING intent only** (`razorpay_payment_id` null); the invoice stayed PARTIAL. **No money moved, nothing marked paid.**
- **Exports** — 200 for admin, `403` for teacher (`exports.manage` is admin-only).
- **Cron** — `/api/v1/internal/jobs/*` rejects unauthenticated and wrong-secret requests, confirming `CRON_SECRET` is wired. **Not** triggered: the secret was not available to this test pass.
- **Certificate PDF** — regenerates correctly (`200 application/pdf`, `%PDF-` header) after its stored artifact was removed (§9).

### Infrastructure — PASS
- **Cold start measured: 22,979 ms** (~23 s) on the first request after idle; warm responses 137–271 ms. This is Render free-tier spin-up, not a code defect, but a first-visit user waits ~23 s.
- API headers: HSTS, CSP, `nosniff`, `SAMEORIGIN`, `no-referrer`; `x-powered-by` correctly absent.
- Concurrency: 20 simultaneous requests → **20/20 HTTP 200**, wall 2,030 ms, p50 1,840 ms.
- Frontend: 20 real routes all 200; no secret markers in the served HTML (`/staff` and `/register` return 404 because those pages do not exist — registration is API-side and staff lives at `/teachers`).

## 6. Production data remediation performed

All approved explicitly before execution. Net result: **2 schools, both `isDemo`; `owner@studyfy.dev` is the only `school_id IS NULL` account; 45/45 migrations.**

- `prisma migrate deploy` — 4 migrations.
- `db:seed` — restored Ramakrishna, added 4 staff logins, refreshed roles/permissions.
- Deleted 11 non-demo schools, 9 orphaned accounts, 4 test students, 9 junk fee structures, 113 stale PENDING payment intents, 4 stray invoices, 2 probe documents.

## 7. Founder actions

1. **`PLATFORM_GSTIN` and `PLATFORM_STATE`** on Render (F7) — required before any real invoice.
2. **Consider `ON DELETE RESTRICT` (or deactivate-then-delete) on `users.school_id`** (F4) — school deletion should not mint platform-level accounts. Needs a migration.
3. **Rotation:** the Aiven and Cloudinary credentials were pasted into chat and into a local file during this window. **Rotate both.** The local credential files are deleted; rotate regardless, since chat history persists.
4. **Render Shell / One-Off Jobs** are unavailable on the free tier — password rotation and seeding must be run from a machine with the database URL, as they were here.
5. **Magic-byte MIME validation** (F5) if document uploads ever handle untrusted external files.
6. **Cloudinary cleanup:** the deleted probe uploads may still exist as orphaned assets in the Cloudinary media library (DB rows are gone, remote blobs are not).

## 8. Open items

- **Web CSP (F2)** — deliberately not enforced. Next.js emits inline hydration scripts; needs a per-route asset inventory plus a `Content-Security-Policy-Report-Only` rollout first. Enforcing blind risks a white screen.
- **`users.school_id` FK (F4)** — schema-level, not fixed; needs a migration decision.
- **Scheduled jobs never fired in this window** — `CRON_SECRET` was unavailable, so no job ran end-to-end. Their logic is covered by Layer 1 unit tests, but live execution is unverified.
- **No email was confirmed received** — the endpoint was verified to respond correctly and not leak, but no inbox was available to confirm delivery.

## 9. Disclosure — two accidental deletions

Both happened during cleanup and are recorded here rather than buried:

1. **Seeded certificate artifact.** A cleanup pass intended to delete only my own probe uploads removed `documents` row `cmus2r5pl0003jg1ysevogenc` (type `CERTIFICATE`, dated 2026-10-03 — pre-existing demo data, not mine). The `Certificate` row `CERT/2026/0001` (BONAFIDE, Ishita Choudhary) **survived**; `documentId` is nullable by design and the API regenerates the PDF from its stored payload snapshot. Verified: `/certificates/<id>/pdf` → `200 application/pdf`, valid `%PDF-` header. **No user-visible breakage, no data loss of record.**
2. **Pre-existing PARTIAL invoice.** A date-filtered cleanup for invoices generated during this pass was too broad and also removed the seeded PARTIAL invoice for Aarav Nair (and its 2 payments). **Fully restored** by re-running the deterministic `db:seed`; the school is back to a canonical seeded invoice set.

Lesson applied: both came from cleanup filters that were wider than intended. The final hygiene pass was re-run against the seed so the demo data is deterministic rather than hand-pruned.

## 10. Residual risks

1. **~23 s cold start** on Render free tier — the single most visible demo weakness.
2. **Cron jobs unverified live** (no secret available).
3. **Schema `SET NULL` on `users.school_id`** is still a latent escalation path for any future school deletion.
4. **No CSP on the web app** until the report-only rollout is done.
5. **Email delivery unconfirmed** — only the API contract was verified.

## 11. Cleanup performed

- All temporary credential files deleted: local credential note, gitignored access note, and every temp token/login payload (owner, parent, test-school, invoice-generation, certificate PDF).
- The credential file is now gitignored and was never in any commit (verified against full history).
- Both Layer 2 test schools and all e2e leftovers removed from the database.
- Probe documents deleted; stray payment intents and test students removed.
- No secrets, tokens, or passwords appear in this report.
