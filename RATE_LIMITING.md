# Login Rate Limiting — per-account ONLY (IP bucket removed 2026-10-01, founder decision)

**Current state (production):** `POST /api/v1/auth/login` carries ONE
guard — **5 FAILED attempts / 15 min / ACCOUNT**, answering `429
RATE_LIMITED` ("Too many login attempts for this account. Try again in
15 minutes."):
- **Account bucket** (`LOGIN_ACCOUNT_LIMIT_MAX`, default 5): keyed on the
  normalized email (case + padding don't open new buckets). Successful
  logins don't consume budget; logout is a separate, unlimited endpoint —
  so normal login/logout cycles can NEVER trigger a lockout. Only repeated
  failures on ONE email lock THAT email; every other account stays usable.

**Why the IP bucket is gone:** behind Render's proxy chain one client lands
in different IP buckets per request (proven live: RateLimit-Remaining jumped
3→1→2 across back-to-back requests), AND behind shared IPs one person's
failures locked out innocent accounts (a whole test session from one browser
burned the shared budget — e.g. the owner account locked while someone else
was hammering logins). Per-account keying fixes both: hammer one account and
the 6th attempt is refused no matter the IPs involved. Enumeration-safe 401s
mean spraying across accounts gains little. Accepted tradeoff on record:
many-account guessing from one IP is throttled only per-account (5 tries
each) — deliberately accepted over locking out real users.

**Why it exists (spec §11 sliding window):** without a guard, anyone can
hammer the login endpoint with password lists (credential stuffing).

## Verify it

5 bad logins for one email → 6th returns 429; a different email still gets
401/200; a good login for the locked email is refused until the window
passes. The account-limiter suite (`apps/api/tests/auth-login-limiter.test.ts`)
covers exactly this — run it green after any auth change.

## What stays guarded meanwhile

Register/forgot/reset (10/hour/IP shared) and public enquiries (5/15min/IP)
still have their per-IP limiters. The e2e suite consumes 3 register-bucket
slots and 1 enquiry slot per run, so local back-to-back runs would exhaust
10/hour by the 4th run and 5/15min by the 6th — the local API start command
therefore sets `REGISTER_RATE_LIMIT_MAX` and `ENQUIRY_RATE_LIMIT_MAX`
(local-only; never set them in CI/production). Once a bucket is spent the API
answers `429 RATE_LIMITED` ("Too many registrations" / "Too many
enquiries") — restart the API or wait out the window if you run without the
overrides.

## Local testing override (login)

- `LOGIN_ACCOUNT_LIMIT_MAX` — account bucket (default 5).
- Set to 200 in the local API start command. E2E hammers the same demo
  accounts dozens of times per run; without the override, demo accounts
  lock mid-suite. Never set it in CI/production.
