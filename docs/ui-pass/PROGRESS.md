# UI/UX Premium Pass — Progress

## Stage 0: Baseline and safety net

**Status:** In progress. No application code has been changed.

### Completed
- Created and switched to `ui-premium-pass` from the clean `main` commit `35c6892`; no merge to `main`.
- Read `RULES.md`, relevant `STUDYFY_PROJECT_SPEC.md` sections (§8.1–8.5, §13.8–13.11, §16.1), `DEMO_DATA.md`, `CURRENT_TASK.md`, `STATUS.md`, `BUGSFIX.md`, and the six written role-board documents.
- Confirmed `docs/designs/` contains written board specs and no PNG screenshots; visual comparisons must use those specifications unless the founder provides images.
- Confirmed the repository ignores `test-artifacts/`; audit artifacts should remain untracked.
- Did not open or inspect any `.env` file and have not contacted a live site or service.
- The documented data directory is now running as MySQL 8.0.46 on loopback `127.0.0.1:3307`. A direct identity query confirmed port 3307 and the local database names `studyfy_dev` and `studyfy_test`; port 3306 was not used.
- `prisma migrate deploy --schema prisma/schema.prisma` against local `studyfy_dev`: 45 migrations found, no pending migrations.
- Two consecutive `npm run db:seed` runs against local `studyfy_dev` both completed and reported the same two seeded slugs and owner; the seed used its documented local-development fallback.
- Seed idempotency check around a third seed: counts remained `schools=67`, `users=146`, `students=28`, `roles=8`.
- `studyfy_test` on local port 3307: 45 migrations found, none pending.
- Root `npm run lint`: exit 0.
- `npm audit --audit-level=high`: exit 1, reporting 24 vulnerabilities (18 moderate, 5 high, 1 critical). Critical: Next.js 16.3.8 is within the affected range; audit reports advisories for Image Optimization API RCE, App Router Server Actions DoS, and `use cache` typed-array RCE. High findings include body-parser (compressed request DoS), follow-redirects (credential/header handling), multer (upload-request DoS), Vite (dev-server issues), and Zod (validation memory exhaustion).
- Stopped further Stage 0 work at the repository's mandatory security-audit decision gate. No automatic dependency fix or gate downgrade was performed.

### Remaining
- Compare local seeded-row counts around a third seed; migrate `studyfy_test` only on loopback.
- Install dependencies only if absent or required by a validation failure.
- Run migrations and the seed twice; record idempotency evidence.
- After founder decision, address or document the high/critical dependency advisories without lowering the audit gate, then run root build, typecheck, lint, API tests, and E2E tests; record actual counts and blockers.
- Start the web/API locally and verify their health without using live credentials.
- Build and run the reusable route/role/viewport audit harness; capture the required local before screenshots where routes can be safely reached.

### Exact next step
Get founder disposition for npm audit's critical/high advisories before continuing.

### Constraints / blockers
- There is no `ui-premium-pass` branch on origin yet; push this branch only after the stage closes with a verified commit.
- `docs/designs/*.png` was requested in the brief, but the repository intentionally contains only Markdown boards.
- Some full-suite and per-role E2E flows may require a local test DB and local servers. Never point them at production.
- The user brief explicitly says local-only/no live-site changes, so repo RULES.md §9's normal live deploy verification is intentionally out of scope; record this deliberate deviation in STATUS.md at task close.
