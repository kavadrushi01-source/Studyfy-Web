import { Router, type CookieOptions, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { registerLimiter } from "../../middleware/security.js";
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from "./auth.schemas.js";
import { AuthError, login, logout, register, requestPasswordReset, resetPassword, rotateRefreshToken } from "./auth.service.js";

export const REFRESH_COOKIE = "studyfy_refresh";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    // Cookies only go over HTTPS in production; plain HTTP locally.
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/auth",
    maxAge: SEVEN_DAYS_MS,
  };
}

function sendAuthError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

export const authRouter = Router();

// Current identity for dashboard headers ("Good morning, {name}") and
// role-aware navigation. Auth only — no tenant scope, so the Platform
// Owner (no school) can call it too. Reads the row fresh so renames and
// role changes reflect immediately instead of lingering until re-login.
authRouter.get(
  "/me",
  authMiddleware,
  catchAsync(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.userId ?? "" },
      select: { id: true, name: true, email: true, schoolId: true, role: { select: { name: true } } },
    });
    if (!user) {
      res.status(401).json({
        success: false,
        data: null,
        error: { code: "UNAUTHENTICATED", message: "Account no longer exists." },
        meta: null,
      });
      return;
    }
    res.json({
      success: true,
      data: { user: { id: user.id, name: user.name, email: user.email, schoolId: user.schoolId, role: user.role.name } },
      error: null,
      meta: null,
    });
  }),
);

authRouter.post(
  "/register",
  registerLimiter(),
  catchAsync(async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      const result = await register(parsed.data);
      res
        .status(201)
        .cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions())
        .json({
          success: true,
          data: { school: result.school, user: result.user, accessToken: result.accessToken },
          error: null,
          meta: null,
        });
    } catch (err) {
      sendAuthError(res, err);
    }
  }),
);

authRouter.post(
  "/login",
  // NOTE (dev/testing period): the login rate limiter is deliberately OFF
  // (see RATE_LIMITING.md — restore it before any real-business use).
  catchAsync(async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      const result = await login(parsed.data);
      res
        .status(200)
        .cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions())
        .json({
          success: true,
          data: { user: result.user, accessToken: result.accessToken },
          error: null,
          meta: null,
        });
    } catch (err) {
      sendAuthError(res, err);
    }
  }),
);

authRouter.post(
  "/refresh",
  catchAsync(async (req: Request, res: Response) => {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) {
      res.status(401).json({
        success: false,
        data: null,
        error: { code: "INVALID_REFRESH_TOKEN", message: "Refresh token is invalid or expired." },
        meta: null,
      });
      return;
    }
    try {
      const result = await rotateRefreshToken(raw);
      res
        .status(200)
        .cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOptions())
        .json({
          success: true,
          data: { user: result.user, accessToken: result.accessToken },
          error: null,
          meta: null,
        });
    } catch (err) {
      if (err instanceof AuthError) {
        res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
      }
      sendAuthError(res, err);
    }
  }),
);

// POST /auth/logout — no auth middleware (the cookie IS the credential,
// and its absence must still succeed). Always clears the cookie.
authRouter.post(
  "/logout",
  catchAsync(async (req: Request, res: Response) => {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await logout(raw);
    res
      .clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" })
      .json({ success: true, data: { loggedOut: true }, error: null, meta: null });
  }),
);

// POST /auth/forgot-password — enumeration-safe: identical 200 whatever
// was looked up, whatever was found. registerLimiter covers this rare
// unauthenticated write (shared bucket is fine — both are human-paced).
authRouter.post(
  "/forgot-password",
  registerLimiter(),
  catchAsync(async (req: Request, res: Response) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    await requestPasswordReset(prisma, parsed.data);
    // The raw token NEVER leaves in the response — it travels by email.
    res.json({ success: true, data: { received: true }, error: null, meta: null });
  }),
);

// POST /auth/reset-password — consumes the single-use token (§13.3).
authRouter.post(
  "/reset-password",
  registerLimiter(),
  catchAsync(async (req: Request, res: Response) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      await resetPassword(prisma, parsed.data);
      res.json({ success: true, data: { reset: true }, error: null, meta: null });
    } catch (err) {
      sendAuthError(res, err);
    }
  }),
);
