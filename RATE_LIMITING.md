# Login Rate Limiting — OFF for now, restore before real business use

**Current state (dev/testing):** `POST /api/v1/auth/login` has NO rate
limiter. Log in as many times as you like — all demo roles back to back.

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

Register (10/hour/IP) and public enquiries (5/15min/IP) still have their
limiters — those endpoints are rarely hit in testing, so they were left
alone.
