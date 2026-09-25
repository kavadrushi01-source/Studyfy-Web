import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { requestPasswordReset } from "../src/modules/auth/auth.service.js";
import { setMailer, stubMailer, type PasswordResetEmail } from "../src/lib/mailer.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

const sent: PasswordResetEmail[] = [];

beforeAll(() => {
  setMailer({ ...stubMailer, sendPasswordResetEmail: async (email) => { sent.push(email); } });
});

afterAll(() => {
  setMailer(null);
});

async function registerAdmin(): Promise<{ email: string; password: string; slug: string; userId: string }> {
  const email = `reset-admin-${uid()}@example.com`;
  const password = "password-123";
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Reset School ${uid()}`,
      adminName: "Reset Admin",
      adminEmail: email,
      adminPassword: password,
    })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  const user = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email } } });
  return { email, password, slug: res.body.data.school.slug as string, userId: user.id };
}

describe("password reset (§13.3 single-use tokens)", () => {
  it("resets end to end: email attempted, token works once, password actually changed", async () => {
    const admin = await registerAdmin();
    sent.length = 0;

    const forgot = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: admin.email, schoolSlug: admin.slug })
      .expect(200);
    expect(forgot.body.data.received).toBe(true);
    // The raw token NEVER leaks over HTTP.
    expect(JSON.stringify(forgot.body)).not.toContain("token");

    // The email went out to the right address with a usable link...
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(admin.email);
    const linkToken = new URL(sent[0]?.link ?? "").searchParams.get("token");
    expect(linkToken).toBeTruthy();

    // Use the emailed link token (proves the mailed token is the live one).
    const hashBefore = (await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } })).passwordHash;
    await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: linkToken ?? "", newPassword: "brand-new-password-456" })
      .expect(200);

    // §13.3's DB rule: the password field actually changed — new works...
    const hashAfter = (await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } })).passwordHash;
    expect(hashAfter).not.toBe(hashBefore);
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: admin.email, password: "brand-new-password-456", schoolSlug: admin.slug })
      .expect(200);
    // ...old does not.
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: admin.email, password: admin.password, schoolSlug: admin.slug })
      .expect(401);

    // Single use: the same link is dead now.
    const reuse = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: linkToken ?? "", newPassword: "another-password-789" })
      .expect(401);
    expect(reuse.body.error.code).toBe("INVALID_RESET_TOKEN");
  });

  it("rejects expired tokens and unknown tokens identically (no oracle)", async () => {
    const admin = await registerAdmin();
    const { createHash } = await import("node:crypto");
    const stale = `stale-${uid()}-token-value-0000000000000000`;
    await prisma.authToken.create({
      data: {
        userId: admin.userId,
        type: "PASSWORD_RESET",
        tokenHash: createHash("sha256").update(stale).digest("hex"),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const expired = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: stale, newPassword: "brand-new-password-456" })
      .expect(401);
    const garbage = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: "never-existed-token-value-000000000000", newPassword: "brand-new-password-456" })
      .expect(401);
    expect(expired.body.error.code).toBe("INVALID_RESET_TOKEN");
    expect(garbage.body.error.code).toBe(expired.body.error.code);
    expect(garbage.body.error.message).toBe(expired.body.error.message);
  });

  it("forgot-password is enumeration-safe and validates input", async () => {
    const admin = await registerAdmin();
    const known = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: admin.email, schoolSlug: admin.slug })
      .expect(200);
    const unknown = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: `nobody-${uid()}@example.com`, schoolSlug: admin.slug })
      .expect(200);
    const wrongSlug = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: admin.email, schoolSlug: "wrong-slug" })
      .expect(200);
    // Byte-identical success shape in all three cases.
    expect(JSON.stringify(unknown.body)).toBe(JSON.stringify(known.body));
    expect(JSON.stringify(wrongSlug.body)).toBe(JSON.stringify(known.body));

    const bad = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: "not-an-email" })
      .expect(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
    const weak = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: "some-token-value-0000000000000000", newPassword: "short" })
      .expect(400);
    expect(weak.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("a password reset kills live refresh chains (thief logged out too)", async () => {
    const admin = await registerAdmin();
    const logged = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: admin.email, password: admin.password, schoolSlug: admin.slug })
      .expect(200);
    const raw = logged.headers["set-cookie"] as unknown as string | string[];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const cookie = list.find((c) => c.startsWith("studyfy_refresh="))?.split(";")[0] ?? "";
    expect(cookie.length).toBeGreaterThan(0);

    const { debugToken } = await requestPasswordReset(prisma, { email: admin.email, schoolSlug: admin.slug });
    await request(app)
      .post("/api/v1/auth/reset-password")
      .send({ token: debugToken ?? "", newPassword: "post-theft-password-000" })
      .expect(200);
    // The pre-reset refresh chain is dead.
    await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie).expect(401);
  });
});
