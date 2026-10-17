# Layer 1 Report — local-only full verification (Phases 0–4)

Local only: code, fresh local DB, seeded demo schools, a self-registered third
school, mocked externals, Playwright against local servers. No live touch, no
keys. Every number below is from a real command run, not memory.

## Stage 0 — Clean baseline

- Fresh DB `studyfy_layer1` (CREATE DATABASE, never touching dev/e2e/test):
  `migrate deploy` → "All migrations have been successfully applied."
- Seed twice (`db:seed`, `DEMO_PASSWORD=Layer1-Seed-Check-001`, throwaway
  local-only value): run 1 → users 52, students 16, schools 2, roles 8;
  run 2 → 52/16/2/8 identical + permissions 51. Idempotent, no duplicates.
- Spec/images note: `docs/designs/` holds 7 written board files, ZERO image
  files — the five reference PNGs §8/§19 expects were never saved in this
  environment. Per the spec's own fallback ("§8.2–§8.4 written to stand on
  their own"), Stage 5 compares against the written boards. Flagged as a
  spec-vs-repo gap, not a product defect.
- Builds: API `tsc -p` exit 0; web Next build exit 0 (cmd-style env).
  Typechecks strict 0/0. Root lint exit 0. `npm audit`: 0 vulnerabilities.
- CI script names: every `npm run X` in ci.yml resolves (workspace-qualified
  where root lacks the script: typecheck/start; `test:e2e` exists on web).
  `npm audit --audit-level=high` in CI is weaker than the local `npm audit`
  run above (0 total). `gh` keyring broken on this box — Actions-tab check
  stays founder-side.
- `migrate diff` (migrations vs schema, scratch shadow DB): "No difference
  detected." exit 0. Scratch DB dropped after.
- FULL API run 1: 96 files / 456 tests passed, first try, ~473s.
- FULL API run 2: 96 / 456 passed, first try, ~396s.
- FULL e2e run 1: 97/97 passed, zero flakes, ~3min.
- FULL e2e run 2: 97/97 passed, zero flakes, ~3min.
- STAGE 0 VERDICT: clean baseline, no flakes across 4 full runs.

## Stage 2 — Security at API level (2026-10-15, complete)

- Route audit + TENANT_MODELS drift: permanent `route-auth-audit.test.ts`
  (154 routes classified: tenant 118, platform 25, device 1, cron 1,
  bare-auth 1, public 8 — every one in exactly one auth path; no drift).
  Re-ran 2/2.
- FINDING #61 (S2, fixed at root): rate-limiter factories minted per-route
  budgets — register/forgot/reset had 3×10/hour instead of one shared
  bucket (proven by the new test: budget spent, forgot still 200), same
  shape on exportLimiter. Fix: shared module-level MemoryStores. Test
  failed before, passes after. BUGSFIX-61 logged. The export test now also
  proves tenant and owner exports share one per-school hourly budget.
- JWT hardening: access and impersonation tokens explicitly sign HS256, and
  verification explicitly accepts only HS256. Expanded JWT coverage rejects
  wrong-secret forgeries, expired tokens, `alg:none`, RS256-signed tokens,
  and opaque refresh tokens used as bearer tokens; refresh cookies are
  asserted HttpOnly, path-scoped, and SameSite=Lax.
- New: `security-input.test.ts` (6/6 green) — JWT forgery/expiry/alg:none/
  RS256/refresh-token misuse rejected; mass assignment ignored on
  register+admit; sort/pagination injection → 400; CRLF/unicode/SQLi stored
  verbatim with no header reflection; MIME spoof both directions 415;
  traversal filename neutralized; live Razorpay keys refused (500), unset
  clean (503).
- New: `rate-limits.test.ts` (shared bucket) + `enquiry-limiter.test.ts`
  (5+1) — production defaults proven, not just bypass behavior.
- Security regression sweep, all green: auth cluster 20/20, impersonation
  19/19, read-only 5/5, realtime/message-realtime 5/5, fees-webhook 5/5,
  fees-online 5/5, fees-verify 3/3, security-matrix 6/6, hardening 5/5,
  tenant-isolation 2/2, register/enquiry/login/ticket/export limiter tests
  green.
- Secrets: repo+history scans clean (only intentionally invalid
  `rzp_live_fake` / `rzp_live_accident` test canaries); `.env` ignored,
  `.env.example` placeholders only; no private keys tracked.
- STAGE 2 VERDICT: complete. No open security-matrix item remains at API
  level.

## Stage 1 — Matrix + gaps (2026-10-15)

- Wrote `docs/testing/LAYER1_MATRIX.md`: 27 §7 modules → code → test files;
  8 roles × allow/deny from `ROLE_PERMISSIONS`; 154 routes with auth paths
  (tenant 118, platform 25, device 1, cron 1, bare-auth 1, public 8);
  §10-vs-mounted deltas (all legitimate); DoD re-verified (no downgrades).
- Gap found + closed: no test pinned route→auth-path or TENANT_MODELS drift
  → new `route-auth-audit.test.ts` (fails the build otherwise). It caught 2
  of my own test bugs first (path-vs-auth counting, schema path), 0 real
  holes — no drift exists.
- Committed `1fbbc8d`, pushed.

## Stage 3 — Functional bug sweep (2026-10-16, complete)

18 confirmed functional bugs, each fixed with a red-first regression test and
logged in BUGSFIX.md as #63–#80:

- Privacy/leaks: data export shipped INTERNAL support-note attachments to
  the student (#65); `message:new` socket events carried full message
  content to same-school non-participants (#66).
- Status/derivation: OVERDUE was never written by anything (#63); failed
  reminder sends consumed the reminder slot forever (#64); partial payment
  on an OVERDUE invoice silently downgraded it to PARTIAL (#63).
- Validation: `??` vs `||` let an enquiry through with no usable contact
  (#67); guardian could be the student's own email (#68); bulk
  attendance/marks accepted duplicate studentIds (#69); impossible rollover
  dates (Feb 30) passed `Number.isNaN(new Date(...))` across six schema
  families (#70); future-dated attendance inflated percentages (#71).
- Timezone: attendance summary defaulted "this month" to the UTC month, not
  the school's calendar month — wrong dashboard totals for UTC+14/UTC
  schools (#72).
- Idempotency/audit: absentee alerts re-spammed on every re-mark (#73);
  biometric device overwrites were unaudited and left stale boards (#74);
  owner boards went stale after trial extension and demo reset (#77).
- Rendering: report cards crashed or printed `Rank: 0` for unranked pupils;
  dateless exam windows silently defaulted to a UTC month (#75).
- Billing: subscription invoices didn't record the purchased plan, so
  capture could mirror the wrong tier (#76); demo upload caps missed
  homework submissions and certificates (#78).
- Concurrency (DB backstops, not app-level checks): timetable replace was
  non-atomic and a teacher could be double-booked (#79); concurrent invoice
  generation double-billed every pupil for the same structure; certificate
  serials could duplicate or orphan uploads under a race (#80).
- BUGSFIX-62 (fee payment lost updates, CAS + 3-attempt retry + honest 409)
  also proven here by reverting the CAS and watching both tests fail.

Gates: FULL API 101 files / 485 tests — 484 green, the one failure is the
known Windows Prisma worker-crash class (3221226505, `sections.test.ts`,
solo 5/5 green). Typecheck 0/0, root lint exit 0. Three new local-only
migrations applied to dev/test/e2e/layer1 (NOT prod — Layer 1 is local;
prod `migrate deploy` stays a founder step): `20261016050321`
(subscription invoice plan), `20261016111500` (invoice structure
uniqueness), `20261016113000` (teacher slot uniqueness). Migrations count
local: 45; prod remains at 42.
- STAGE 3 VERDICT: complete. 18/18 findings fixed and pinned.
