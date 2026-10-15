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

## Stage 2 — Security at API level (2026-10-15, in progress)

- Route audit + TENANT_MODELS drift: permanent `route-auth-audit.test.ts`
  (154 routes classified: tenant 118, platform 25, device 1, cron 1,
  bare-auth 1, public 8 — every one in exactly one auth path; no drift).
- FINDING #61 (S2, fixed at root): rate-limiter factories minted per-route
  budgets — register/forgot/reset had 3×10/hour instead of one shared
  bucket (proven by the new test: budget spent, forgot still 200), same
  shape on exportLimiter. Fix: shared module-level MemoryStores. Test
  failed before, passes after. BUGSFIX-61 logged.
- New: `security-input.test.ts` (6/6 green first run) — JWT forgery/expiry/
  alg:none rejected; mass assignment ignored on register+admit; sort/
  pagination injection → 400; CRLF/unicode/SQLi stored verbatim with no
  header reflection; MIME spoof both directions 415; traversal filename
  neutralized; live Razorpay keys refused (500), unset clean (503).
- New: `rate-limits.test.ts` (shared bucket) + `enquiry-limiter.test.ts`
  (5+1) — production defaults proven, not just bypass behavior.
- Verified by reading (suite-green, behavior unchanged): impersonation 19,
  read-only 5, self-scope/parent/payroll colleague denials, biometric
  cross-school, cron unset-503 + double-run, gating/suspended, webhook
  idempotency, honeypot, sort-enum gating.
- Secrets: repo+history scans clean (only fake `rzp_live_fake` canaries);
  `.env` ignored, `.env.example` placeholders only; client bundle has zero
  server-secret names.

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
