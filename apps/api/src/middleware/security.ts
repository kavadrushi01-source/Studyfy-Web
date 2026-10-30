import cors from "cors";
import type { Express } from "express";
import { MemoryStore, rateLimit } from "express-rate-limit";
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

// Login brute-force guard (§11 sliding window): 5 FAILED attempts /
// 15 min / ACCOUNT, keyed on the normalized email. Per-IP limiting was
// removed (founder decision): behind Render's proxy chain one client lands
// in different IP buckets per request (proven live: RateLimit-Remaining
// jumped 3→1→2 across back-to-back requests), AND behind shared IPs one
// person's failures locked out innocent accounts. Keying on the email makes
// brute force deterministic: hammer one account and the 6th attempt is
// refused no matter which IP it arrives from — while every other account
// stays usable. Combined with enumeration-safe 401s (no account oracle),
// spraying across accounts gains little. Successful logins don't consume
// budget, so legitimate users with many devices are never locked out by
// their own logins. Logout is a separate, unlimited endpoint. Tradeoff on
// record: without an IP bucket, many-account guessing from one IP is
// throttled only per-account (5 tries each) — accepted deliberately.
// `trust proxy` stays untouched (trusting more hops would let attackers
// spoof IPs and evade entirely, worse than today).
// Own knob LOGIN_ACCOUNT_LIMIT_MAX (default 5, local-only override).
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

export const publicDemoSessionLimiter = () =>
  maybeLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const body = limited("Too many demo sessions started. Try again in 15 minutes.");
      res.status(body.statusCode).type("application/json").send(body.message);
    },
  });

// Register/forgot/reset share this bucket: 10/hour/IP per spec.
// REGISTER_RATE_LIMIT_MAX is a LOCAL-ONLY override -
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
// Register/forgot/reset share ONE bucket (10/hour/IP): the three routes
// mount separate registerLimiter() calls, so without a shared store each
// would get its own 10/hour budget (30/hour total — the documented
// property would be false and a test asserting it would fail). One
// module-level MemoryStore makes the factory shape harmless.
// The deliberate sharing trips express-rate-limit's advisory
// `unsharedStore` validation on every production boot (3 frames at
// import, caught and logged by the library — never fatal, but noise that
// looks like a real error in logs). BUGSFIX-81: silence exactly that
// validation — every other check stays on — because here the store IS the
// budget and sharing is the point.
const registerBucket = new MemoryStore();
export const registerLimiter = () =>
  maybeLimit({
    windowMs: 60 * 60 * 1000,
    limit: registerLimit(),
    store: registerBucket,
    validate: { unsharedStore: false },
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

// Data export (§13.10): one per HOUR per SCHOOL — the export is the
// highest-blast-radius read in the product, so the budget is shared by the
// whole school (keyed on the URL schoolId, which both export routes carry),
// not per account. EXPORT_RATE_LIMIT_MAX is the LOCAL-ONLY override (same
// convention as the knobs above).
function exportLimit(): number {
  const raw = Number(process.env.EXPORT_RATE_LIMIT_MAX);
  if (Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return 1;
}
// Same shared-bucket shape as register: the tenant + owner export routes
// mount separate exportLimiter() calls, but the budget is one per hour
// per SCHOOL (§13.10), so they share one store keyed on the school id.
// Same BUGSFIX-81 silencing: sharing here is the documented behavior.
const exportBucket = new MemoryStore();
export const exportLimiter = () =>
  maybeLimit({
    windowMs: 60 * 60 * 1000,
    limit: exportLimit(),
    store: exportBucket,
    validate: { unsharedStore: false },
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const params = (req as { params?: unknown } as { params?: { schoolId?: unknown } }).params;
      const schoolId = params?.schoolId;
      // Owner route uses :id instead of :schoolId — same school either way.
      const id = (params as { id?: unknown } | undefined)?.id;
      const key = typeof schoolId === "string" && schoolId ? schoolId : typeof id === "string" && id ? id : "no-school";
      return `export:${key}`;
    },
    handler: (_req, res) => {
      const body = limited("An export was already generated for this school within the hour. Try again later.");
      res.status(body.statusCode).type("application/json").send(body.message);
    },
  });

// Ticket creation (§7 #27): 20 / hour / ACCOUNT, keyed on the user id
// (authenticated route — the founder's proxy decision rules out IP buckets
// here exactly as for login). Tickets are rare and human; 20 absorbs any
// legitimate burst (a school onboarding week) while capping scripted spam.
// Mounts AFTER auth+tenant+permission so unauthenticated and unpermitted
// hits never consume budget. TICKET_CREATE_LIMIT_MAX is the LOCAL-ONLY
// override (same convention as the knobs above).
function ticketCreateLimit(): number {
  const raw = Number(process.env.TICKET_CREATE_LIMIT_MAX);
  if (Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return 20;
}
export const ticketCreateLimiter = () =>
  maybeLimit({
    windowMs: 60 * 60 * 1000,
    limit: ticketCreateLimit(),
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = (req as { user?: unknown } as { user?: { userId?: unknown } }).user?.userId;
      return typeof userId === "string" && userId ? userId : "no-user";
    },
    handler: (_req, res) => {
      const body = limited("Too many tickets opened. Try again later.");
      res.status(body.statusCode).type("application/json").send(body.message);
    },
  });
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
