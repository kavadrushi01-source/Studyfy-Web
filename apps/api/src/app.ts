import cookieParser from "cookie-parser";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { authRouter } from "./modules/auth/auth.router.js";
import { platformRouter } from "./modules/platform/platform.router.js";
import { publicRouter } from "./modules/public/public.router.js";
import { studentsRouter } from "./modules/students/students.router.js";
import { applyCors, applyHelmet } from "./middleware/security.js";

export function createApp(): Express {
  const app = express();
  // Behind Render's proxy in production: trust exactly one hop so
  // rate limiters see the real client IP (spec §12.1, §13).
  app.set("trust proxy", 1);
  applyHelmet(app);
  applyCors(app);
  app.use(express.json());
  app.use(cookieParser());

  // Blank hello-world route — real modules mount under /api/v1/... per spec §10.
  app.get("/api/v1/hello", (_req, res) => {
    res.json({ success: true, data: { message: "hello from studyfy api" }, error: null, meta: null });
  });

  // Auth is intentionally UNauthenticated + UNscoped (spec §13.4): register
  // creates the school, login/refresh mint the credentials everything else
  // derives school_id from. tenantMiddleware starts after this.
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/platform", platformRouter);
  app.use("/api/v1/public", publicRouter);
  app.use("/api/v1", studentsRouter);

  // Liveness probe (spec §13.5 / RULES.md §4).
  app.get("/health", (_req, res) => {
    res.json({ success: true, data: { ok: true }, error: null, meta: null });
  });

  // Minimal JSON fallback until the centralized errorMiddleware lands
  // (hardening box, spec §13.2). Never leaks stack traces (RULES.md §4).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    if (res.headersSent) {
      return;
    }
    res.status(500).json({
      success: false,
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
      meta: null,
    });
  });

  return app;
}
