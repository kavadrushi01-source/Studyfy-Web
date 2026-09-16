import { Router, type CookieOptions, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { loginSchema, registerSchema } from "./auth.schemas.js";
import { AuthError, login, register, rotateRefreshToken } from "./auth.service.js";

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

authRouter.post(
  "/register",
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
