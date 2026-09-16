import jwt from "jsonwebtoken";

export interface AccessTokenPayload {
  sub: string;
  schoolId: string | null;
  role: string;
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
