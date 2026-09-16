import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("scaffold", () => {
  it("GET /api/v1/hello returns hello-world envelope", async () => {
    const res = await request(createApp()).get("/api/v1/hello");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.message).toBe("hello from studyfy api");
  });

  it("GET /health returns ok", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
  });
});
