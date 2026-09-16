import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

export interface AuthUser {
  userId: string;
  schoolId: string | null;
  role: string;
}

interface AccessJwt {
  sub: string;
  schoolId: string | null;
  role: string;
  type: string;
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
    req.user = { userId: payload.sub, schoolId: payload.schoolId ?? null, role: payload.role };
    next();
  } catch {
    unauthorized(res, "Invalid or expired token.");
  }
}
