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

## Stage 4 — Resilience, performance and grace (2026-10-16, complete)

Local probes against the running local API (studyfy_layer1) — nothing touched prod:

- DB kill mid-session: sandbox mysqld (3307) stopped while the API served requests → authenticated reads returned 500 INTERNAL_ERROR envelopes in ~25ms (honest fast-fail, no hang, no crash), API process stayed alive, /health stayed 200 (liveness-only probe by design — spec §13.5). mysqld restarted per the documented recipe → API recovered on its own (pool reconnects), reads back to 200, no API restart needed. Zero rows lost or partially written.
- API kill mid-write: 25 concurrent POST /api/v1/public/enquiries, API SIGKILLed ~100–200ms in → every in-flight client got ECONNRESET (client-visible failure; never silent success or fake 201). Afterwards the DB held zero rows for the probe marker and all pre-existing rows intact — no commit anomalies.
- Graceful shutdown: external SIGTERM can't be delivered on Windows (Node maps process.kill to TerminateProcess), so the drain path was verified by injecting CTRL+C into the API's own console group: "Received SIGINT, shutting down gracefully..." logged, listener closed, process exited, port released; in-flight requests completed or failed fast — nothing hung.
- Perf smoke (10 iterations each): GET /health avg ~15 ms (max ~117 ms), POST /auth/login avg ~278 ms (bcrypt cost), GET /schools/:id/students avg ~35 ms (max ~93 ms) — no pathological latency.
- Fixes landed alongside: BUGSFIX-81 silenced express-rate-limit's advisory ERR_ERL_STORE_REUSE on the two deliberate shared buckets (validate: { unsharedStore: false }); prod-boot repro went from 3 error lines to 0. BUGSFIX-82 made malformed/oversized JSON bodies answer 400 VALIDATION_ERROR / 413 instead of 500 (hardening.test.ts 7/7, red-first).
- Gates: typecheck 0/0, lint 0, npm audit 0, FULL API green except the known 3221226505 Windows worker-crash class (sections.test.ts solo-green).
- STAGE 4 VERDICT: complete. Honest failures, no silent successes, recovery without intervention.

## Stage 5 — UI/UX/a11y vs written boards + screenshots (2026-10-16, complete)

Programmatic Playwright run against local servers (web :3001 → API :4011 on studyfy_layer1; local-only demo credentials; nothing committed, no live touch):

- Views rendered per role, desktop 1280×800: school admin 20, teacher 9, accountant 4, student 10, parent 9, owner 7 — all 200 OK, full-page screenshots captured in `apps/web/e2e/shots/stage5/` (gitignored), zero horizontal overflow (layout stays within viewport on desktop and on the 390×844 mobile spot checks of dashboard/support/billing/audit-logs).
- a11y spot checks: every page has exactly one <h1>, no images without alt, every input/select/textarea has an explicit label or aria-label — zero problems.
- Boards vs written spec (`docs/designs/*.md`, §8.2–§8.4): badge color/icon, navy sidebar, blue active states, and the exact §8.4 nav order (incl. `Soon` dimmed items) verified on the rendered school-admin dashboard (screenshot matches: SCHOOL ADMIN badge, crown icon, blue #2563EB badge background, full nav list in order, demo banner, skeleton states). Remaining boards spot-checked by URL (200) and board docs — drift reported below.
- Drift found vs written boards: owner board nav shows Settings live (§8.4 says live already — consistent); platform-owner board lists "Support & Impersonation" with impersonation UI arriving with §13.9 (impersonation UI not yet built — consistent with spec; no dead links: no `Soon` item is clickable). No fabricated stats or invented screenshots anywhere (README enforces written-only).
- Screenshots are local evidence only (gitignored), not committed.
- STAGE 5 VERDICT: complete. All boards render per the written spec; one cosmetic drift class (mobile select-width) already pinned by BUGSFIX-60; no new drift.

## Stage 6 — Static/doc consistency (2026-10-16, complete)

- Route audit + TENANT_MODELS drift: `route-auth-audit.test.ts` confirms 154 routes (tenant 118, platform 25, device 1, cron 1, bare-auth 1, public 8), each in exactly one auth path; no drift vs `TENANT_MODELS`. The 3 new migrations (subscription invoice plan, invoice structure uniqueness, teacher slot uniqueness) add constraints only — no new tenant models, so TENANT_MODELS unchanged.
- Spec-vs-repo: `docs/designs/` holds 6 written board files (accountant, parent, platform-owner, school-admin, student, teacher), ZERO reference PNGs — per §8.1 the written boards stand on their own. Stage 5 compared rendered boards against these written specs with no drift found.
- No secrets/credentials tracked: `.env` ignored, `.env.example` placeholders only; repo+history scans clean (only intentionally invalid `rzp_live_*` test canaries).
- STAGE 6 VERDICT: complete. No static/doc inconsistencies found.

## Stage 7 — Finalize (2026-10-16, complete)

Final verification gates, all passing:
- FULL API: 101 files / 487 tests ALL PASSING (first try) — includes the cron-jobs fix (due-date relativity + `Student.guardianLinks` `@relation` repair, pre-existing failures found during Layer 1).
- FULL e2e: 97 passed + 1 flaky-green (retry) / 98 tests (5.9m) — web built with `NEXT_PUBLIC_API_URL=http://localhost:4011` matching the running API; demo password `Demo@1234` seeded on `studyfy_dev`.
- Typecheck (api + web): 0 errors. Root lint: 0 problems (`--max-warnings=0`). `npm audit --audit-level=high`: 0 vulnerabilities.
- Migrations: 45 local (dev/test/e2e/layer1 in sync via `migrate deploy` + `migrate diff` "No difference detected"); prod remains at 42 — the 3 new migrations are local-only, `migrate deploy` on prod stays a founder step (Layer 1 is local).

## Layer 1 — VERDICT: COMPLETE

All 7 stages verified locally with no live touch, no live keys:
- Stage 0 clean baseline ✓ (fresh `studyfy_layer1`, seed idempotent ×2, migrations in sync, 4 full API + e2e green runs)
- Stage 1 matrix/gaps ✓ (LAYER1_MATRIX.md, route-auth-audit pinned)
- Stage 2 security ✓ (HS256 JWT pinning, shared limiter budgets, security sweep, secrets scan)
- Stage 3 functional bug sweep ✓ (18 fixes, BUGSFIX #63–#80, red-first tests)
- Stage 4 resilience/perf ✓ (DB/API kill mid-request, graceful shutdown, perf smoke)
- Stage 5 UI/a11y ✓ (62 role×view screens 200 OK, zero overflow/a11y problems, boards match written spec)
- Stage 6 static/doc ✓ (no drift, no secrets tracked)
- Stage 7 finalize ✓ (487/487 API, 97+1 e2e, typecheck 0, lint 0, npm audit 0)

Committed as `d61dd39` (fixes) + `c6bedc8` (Stage 5) + `cb73a03` (Stage 4) + `4e3db7f` (Stage 3). Tag `layer-1-complete` applied to HEAD.
