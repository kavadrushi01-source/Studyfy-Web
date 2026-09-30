# Login Rate Limiting — RESTORED 2026-09-27 (before production pilot),
# account-keyed guard added 2026-09-29

**Current state (production):** `POST /api/v1/auth/login` carries TWO
independent guards, both **5 attempts / 15 min**, both answering `429
RATE_LIMITED`:
- **IP bucket** (`LOGIN_RATE_LIMIT_MAX`, default 5): the classic guard.
- **Account bucket** (`LOGIN_ACCOUNT_LIMIT_MAX`, default 5): keyed on the
  normalized email, successful logins don't consume budget. This one is
  the deterministic anti-stuffing guard: per-IP limiting alone proved
  unreliable behind Render's proxy chain (one client landed in different
  IP buckets per request — RateLimit-Remaining jumped 3→1→2 live), so an
  attacker got ~5 tries per bucket instead of 5 total. The account key
  makes brute force fail closed no matter the IPs involved; enumeration-
  safe 401s mean spraying across accounts gains nothing either.

**Why it exists (spec §11 sliding window):** without a guard, anyone can
hammer the login endpoint with password lists (credential stuffing).

## Restore it (when Studyfy serves real schools)

1. In `apps/api/src/modules/auth/auth.router.ts`, re-attach the limiter:
   ```ts
   import { loginLimiter, registerLimiter } from "../../middleware/security.js";

   authRouter.post(
     "/login",
     loginLimiter(),
     catchAsync(async (req: Request, res: Response) => {
   ```
   (That is the exact code that was removed — nothing else changed.)
2. Leave `LOGIN_RATE_LIMIT_MAX` **unset** in production/CI env (default 5
   applies). The variable exists only so a local `.env` could raise it
   during hand-testing; production must never set it.
3. Verify: 5 bad logins → 6th returns 429; 1 good login still returns 200.
   The hardening suite covers limiter behavior — run the full suite green
   after restoring.

## What stays guarded meanwhile

Register/forgot/reset (10/hour/IP shared) and public enquiries (5/15min/IP)
still have their limiters. The e2e suite consumes 3 register-bucket slots and
1 enquiry slot per run, so local back-to-back runs would exhaust 10/hour by
the 4th run and 5/15min by the 6th — the local API start command therefore
sets `REGISTER_RATE_LIMIT_MAX` and `ENQUIRY_RATE_LIMIT_MAX` (same local-only
pattern as `LOGIN_RATE_LIMIT_MAX`; never set them in CI/production). Once a
bucket is spent the API answers `429 RATE_LIMITED` ("Too many registrations"
/ "Too many enquiries") - restart the API or wait out the window if you run
without the overrides.

## Local testing overrides (both login knobs)

- `LOGIN_RATE_LIMIT_MAX` — IP bucket (default 5).
- `LOGIN_ACCOUNT_LIMIT_MAX` — account bucket (default 5).
- Set BOTH to 200 in the local API start command. E2E hammers the same
  demo accounts dozens of times per run; without both overrides, demo
  accounts lock mid-suite. Never set either in CI/production.
