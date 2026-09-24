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

// Login brute-force guard (§11 sliding window). CURRENTLY DISCONNECTED from
// POST /auth/login for the dev/testing period (see RATE_LIMITING.md —
// restore it before any real-business use). CI and production must run the
// default 5; LOGIN_RATE_LIMIT_MAX stays as the local-only override knob.
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

// 10 schools / hour / IP: registrations are rare and human.
export const registerLimiter = () =>
  maybeLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const body = limited("Too many registrations. Try again later.");
      res.status(body.statusCode).type("application/json").send(body.message);
    },
  });

// 5 enquiries / 15 min / IP: the one unauthenticated form is the spam
// target (§13.5) — limiter PLUS the honeypot field in the route.
export const enquiryLimiter = () =>
  maybeLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const body = limited("Too many enquiries. Try again in 15 minutes.");
      res.status(body.statusCode).type("application/json").send(body.message);
    },
  });
