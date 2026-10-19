import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

// Layer 2 live finding: every unmatched route fell through to Express's
// built-in HTML 404 ("Cannot GET /..."), while every other error path in
// app.ts answers the standard {success, data, error, meta} envelope. A client
// that does `await res.json()` on a 404 threw a parse error instead of
// reading error.code, so a typo'd or retired endpoint looked like a crash
// rather than a clean "no such route". Observed live on Render:
//   GET /api/v1/schools/<id>/definitely-not-a-route -> 404 text/html
describe("unmatched routes answer the JSON envelope", () => {
  it("returns a JSON 404 envelope, not an HTML error page", async () => {
    const res = await request(createApp()).get("/api/v1/definitely-not-a-route");

    expect(res.status).toBe(404);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({
      success: false,
      data: null,
      error: { code: "NOT_FOUND", message: expect.any(String) },
      meta: null,
    });
  });

  it("does not leak internals in the 404 body", async () => {
    const res = await request(createApp()).get("/api/v1/schools/does-not-exist/nope/deeper");

    expect(res.status).toBe(404);
    expect(res.body.error.message).not.toMatch(/at |node_modules|\.ts:\d+|stack/i);
  });

  it("still serves real routes (404 handler must not swallow matches)", async () => {
    const ok = await request(createApp()).get("/api/v1/hello");
    expect(ok.status).toBe(200);
    expect(ok.body.data.message).toBe("hello from studyfy api");

    const health = await request(createApp()).get("/health");
    expect(health.status).toBe(200);
    expect(health.body.data.ok).toBe(true);
  });

  it("404s a wrong method on a real path with the same envelope", async () => {
    const res = await request(createApp()).post("/api/v1/hello");
    expect(res.status).toBe(404);
    expect(res.type).toBe("application/json");
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
