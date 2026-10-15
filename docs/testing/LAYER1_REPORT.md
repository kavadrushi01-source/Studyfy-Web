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
