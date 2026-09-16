import express, { type Express } from "express";

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // Blank hello-world route — real modules mount under /api/v1/... per spec §10.
  app.get("/api/v1/hello", (_req, res) => {
    res.json({ success: true, data: { message: "hello from studyfy api" }, error: null, meta: null });
  });

  // Liveness probe (spec §13.5 / RULES.md §4).
  app.get("/health", (_req, res) => {
    res.json({ success: true, data: { ok: true }, error: null, meta: null });
  });

  return app;
}
