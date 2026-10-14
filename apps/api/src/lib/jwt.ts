import jwt from "jsonwebtoken";

export interface AccessTokenPayload {
  sub: string;
  schoolId: string | null;
  role: string;
  // Set ONLY on impersonation sessions (§13.9): the Platform Owner behind
  // the wheel. Absent on every normal login — the guard keys on presence.
  impersonatedBy?: string;
}

function accessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET is not set — see .env.example");
  }
  return secret;
}

// Short-lived (15m) bearer token. schoolId is re-derived from THIS on every
// request by tenantMiddleware — never from client input (spec §13.4).
// NULL schoolId belongs only to the Platform Owner (spec §5).
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign({ ...payload, type: "access" }, accessSecret(), {
    expiresIn: "15m",
  });
}

// Impersonation session token (§13.9): a NORMAL tenant token for the target
// (tenantMiddleware + self-scope apply exactly as to that user — it sees no
// more than they can) plus impersonatedBy, a 30-minute life, and a session
// id (jti) linking the START/END audit rows. NO refresh token is ever
// issued for it — there is no row to rotate, so /auth/refresh 401s.
export interface ImpersonationTokenInput {
  sub: string;
  schoolId: string | null;
  role: string;
  impersonatedBy: string;
  sessionId: string;
}

export function signImpersonationToken(input: ImpersonationTokenInput): string {
  return jwt.sign(
    { sub: input.sub, schoolId: input.schoolId, role: input.role, impersonatedBy: input.impersonatedBy, type: "access" },
    accessSecret(),
    { expiresIn: "30m", jwtid: input.sessionId },
  );
}
