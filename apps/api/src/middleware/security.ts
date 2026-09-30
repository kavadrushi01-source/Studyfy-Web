import cors from "cors";
import type { Express } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";

// helmet: standard secure headers (spec §13.5). Defaults are API-safe.
export function applyHelmet(app: Express): void {
  app.use(helmet());
}

// CORS locked to the real frontend origin(s) (spec §13.5, RULES.md §4).
// - Requests WITHOUT an Origin header (curl, supertest, server-to-server)
//   always pass: CORS is a browser check, and blocking them would break
//   health checks and the test suite for no security gain.
// - Browsers sending any other Origin get NO allow header, so the browser
//   blocks the read. Exact match only — never reflect the request origin.
// FRONTEND_ORIGIN may be a comma-separated list (primary + previews).
export function applyCors(app: Express): void {
  const allowed = (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        callback(null, allowed.includes(origin));
      },
      credentials: true,
    }),
  );
}

function limited(message: string) {
  return {
    statusCode: 429,
    message: JSON.stringify({
      success: false,
      data: null,
      error: { code: "RATE_LIMITED", message },
      meta: null,
    }),
  };
}

// Sliding-window limiters on the unauthenticated endpoints (spec §13,
// RULES.md §4). Per-IP. Disabled under NODE_ENV=test (vitest sets this
// automatically) so the suite can exercise login/register freely — the
// live demo below proves real blocking with NODE_ENV=production.
function maybeLimit(...args: Parameters<typeof rateLimit>) {
  if (process.env.NODE_ENV === "test") {
    return (_req: unknown, _res: unknown, next: () => void) => next();
  }
  return rateLimit(...args);
}

// Login brute-force guard (§11 sliding window): 5 attempts / 15 min / IP.
// Restored before the production pilot (RATE_LIMITING.md) — leave
// LOGIN_RATE_LIMIT_MAX unset in production/CI so the default 5 applies;
// it exists only as a local-testing override.
function loginLimit(): number {
  const raw = Number(process.env.LOGIN_RATE_LIMIT_MAX);
  if (Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return 5;
}
export const loginLimiter = () =>
  maybeLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit(),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const body = limited("Too many login attempts. Try again in 15 minutes.");
      res.status(body.statusCode).type("application/json").send(body.message);
    },
  });

// Account-keyed login guard (same §11 rule, different key): 5 attempts /
// 15 min / ACCOUNT. Per-IP limiting alone is unreliable behind Render's
// proxy chain — one client can land in different IP buckets per request
// (proven live: RateLimit-Remaining jumped 3→1→2 across back-to-back
// requests), so an attacker gets ~5 tries per bucket instead of 5 total.
// Keying on the normalized email makes brute force deterministic: hammer
// one account and the 6th attempt is refused no matter which IPs the
// attempts arrive from. Combined with enumeration-safe 401s (no account
// oracle), spraying across accounts gains nothing either. Successful
// logins don't consume budget, so legitimate users with many devices are
// never locked out by their own logins. Runs IN ADDITION TO the IP
// limiter (defense in depth) — and deliberately does NOT touch
// `trust proxy` (trusting more hops would let attackers spoof IPs and
// evade entirely, worse than today).
// Own knob LOGIN_ACCOUNT_LIMIT_MAX (default 5, local-only override like
// the IP one); headers off so the IP limiter's RateLimit-* headers stay
// canonical — the two limiters are told apart by their 429 messages.
function loginAccountLimit(): number {
  const raw = Number(process.env.LOGIN_ACCOUNT_LIMIT_MAX);
  if (Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return 5;
}
export const loginAccountLimiter = () =>
  maybeLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginAccountLimit(),
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = (req.body as { email?: unknown } | undefined)?.email;
      return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : "no-email";
    },
    skipSuccessfulRequests: true,
    handler: (_req, res) => {
      const body = limited("Too many login attempts for this account. Try again in 15 minutes.");
      res.status(body.statusCode).type("application/json").send(body.message);
    },
  });

// Register/forgot/reset share this bucket: 10/hour/IP per spec. Like
// LOGIN_RATE_LIMIT_MAX, REGISTER_RATE_LIMIT_MAX is a LOCAL-ONLY override -
// the e2e suite legitimately consumes 3 slots per run (2 garbage-token
// probes + 1 forgot-password), so back-to-back runs need headroom.
// CI/production must leave it unset so the default of 10 applies.
function registerLimit(): number {
  const raw = Number(process.env.REGISTER_RATE_LIMIT_MAX);
  if (Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return 10;
}

// 10 schools / hour / IP: registrations are rare and human.
export const registerLimiter = () =>
  maybeLimit({
    windowMs: 60 * 60 * 1000,
    limit: registerLimit(),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const body = limited("Too many registrations. Try again later.");
      res.status(body.statusCode).type("application/json").send(body.message);
    },
  });

// 5 enquiries / 15 min / IP: the one unauthenticated form is the spam
// target (§13.5) — limiter PLUS the honeypot field in the route. Like the
// knobs above, ENQUIRY_RATE_LIMIT_MAX is a LOCAL-ONLY override - the e2e
// suite posts one enquiry per run, so back-to-back runs exhaust the fixed
// 5/15min budget. CI/production must leave it unset so 5 applies.
function enquiryLimit(): number {
  const raw = Number(process.env.ENQUIRY_RATE_LIMIT_MAX);
  if (Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return 5;
}
export const enquiryLimiter = () =>
  maybeLimit({
    windowMs: 15 * 60 * 1000,
    limit: enquiryLimit(),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const body = limited("Too many enquiries. Try again in 15 minutes.");
      res.status(body.statusCode).type("application/json").send(body.message);
    },
  });
