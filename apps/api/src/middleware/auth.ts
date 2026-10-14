import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

export interface AuthUser {
  userId: string;
  schoolId: string | null;
  role: string;
  // Present only on impersonation sessions (§13.9): the Platform Owner
  // behind the wheel. Every read-only guard keys on this claim.
  impersonatedBy?: string;
  // True only on read-only demo sessions (§13.11). Same guard as above.
  readOnly?: boolean;
}

interface AccessJwt {
  sub: string;
  schoolId: string | null;
  role: string;
  type: string;
  impersonatedBy?: unknown;
  readOnly?: unknown;
}

function accessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET is not set — see .env.example");
  }
  return secret;
}

function unauthorized(res: Response, message = "Authentication required."): void {
  res.status(401).json({ success: false, data: null, error: { code: "UNAUTHENTICATED", message }, meta: null });
}

// Verifies the access JWT and pins req.user. Never reads identity from a
// header or body field the client controls — school_id is re-derived from
// THIS token on every request by tenantMiddleware (spec §13.4).
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    unauthorized(res);
    return;
  }
  try {
    const payload = jwt.verify(header.slice("Bearer ".length), accessSecret()) as AccessJwt;
    if (payload.type !== "access" || typeof payload.sub !== "string") {
      unauthorized(res);
      return;
    }
    req.user = {
      userId: payload.sub,
      schoolId: payload.schoolId ?? null,
      role: payload.role,
      // Claim is owner-set at issue; a forged non-string is dropped, never
      // trusted (a forged valid signature is impossible without the secret).
      ...(typeof payload.impersonatedBy === "string" && payload.impersonatedBy ? { impersonatedBy: payload.impersonatedBy } : {}),
      // Strict boolean only — truthy strings never count (§13.11).
      ...(payload.readOnly === true ? { readOnly: true } : {}),
    };
    next();
  } catch {
    unauthorized(res, "Invalid or expired token.");
  }
}
