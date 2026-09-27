# Login Rate Limiting — RESTORED 2026-09-27 (before production pilot)

**Current state (production):** `POST /api/v1/auth/login` is guarded —
**5 attempts / 15 min / IP**, then `429 RATE_LIMITED`. Restored during the
live deploy gate; verified live (5×401 → 429, good login still 200).

**Why it exists (spec §11 sliding window):** without a guard, anyone can
hammer the login endpoint with password lists (credential stuffing). The
production rule is **5 attempts / 15 min / IP**, after which the API
answers `429 RATE_LIMITED` ("Too many login attempts").

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
/ "Too many enquiries") — restart the API or wait out the window if you run
without the overrides.
