import { describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { REFRESH_COOKIE } from "../src/modules/auth/auth.router.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

function refreshCookie(res: { headers: Record<string, string | string[]> }): string | null {
  const raw = res.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const match = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  if (!match) {
    return null;
  }
  return match.split(";")[0] ?? null;
}

describe("POST /api/v1/auth/logout", () => {
  it("revokes renewal, clears the cookie, and never 401s", async () => {
    const email = `logout-admin-${uid()}@example.com`;
    const password = "password-123";
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        schoolName: `Logout School ${uid()}`,
        adminName: "Logout Admin",
        adminEmail: email,
        adminPassword: password,
      })
      .expect(201);
    const slug = registered.body.data.school.slug as string;
    const logged = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password, schoolSlug: slug })
      .expect(200);
    const cookie = refreshCookie(logged);
    expect(cookie).not.toBeNull();

    // Live refresh token dies with logout; the cookie is cleared too.
    const out = await request(app).post("/api/v1/auth/logout").set("Cookie", cookie ?? "").expect(200);
    expect(out.body.data.loggedOut).toBe(true);
    expect(refreshCookie(out)).not.toBeNull();
    await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie ?? "").expect(401);

    // Idempotent: no cookie at all still succeeds.
    await request(app).post("/api/v1/auth/logout").expect(200);
  });
});
