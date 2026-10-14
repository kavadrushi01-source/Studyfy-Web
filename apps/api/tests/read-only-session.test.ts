import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { io as clientIo, type Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { initRealtime, schoolNamespaceOf } from "../src/realtime/server.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const adminEmail = `ro-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Ro Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function loginOwner(): Promise<{ token: string; userId: string }> {
  const email = `ro-owner-${uid()}@example.com`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
  const user = await prisma.user.create({
    data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Ro Owner" },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
  return { token: res.body.data.accessToken as string, userId: user.id };
}

async function mint(ownerToken: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request(app).post("/api/v1/platform/read-only-session").set({ Authorization: `Bearer ${ownerToken}` });
  return { status: res.status, body: res.body as Record<string, unknown> };
}

function data(body: Record<string, unknown>): Record<string, unknown> {
  return body.data as Record<string, unknown>;
}

describe("POST /platform/read-only-session (§13.11)", () => {
  it("mints a 30-minute read-only token with no refresh, and audits START", async () => {
    const owner = await loginOwner();
    const { status, body } = await mint(owner.token);
    expect(status).toBe(200);
    const d = data(body);
    expect(typeof d.accessToken).toBe("string");
    expect(d.refreshToken).toBeUndefined();
    expect(typeof d.expiresAt).toBe("string");
    const ttlMs = Date.parse(d.expiresAt as string) - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60 * 1000);

    const decoded = jwt.decode(d.accessToken as string) as Record<string, unknown> | null;
    expect(decoded?.sub).toBe(owner.userId);
    expect(decoded?.role).toBe("PLATFORM_OWNER");
    expect(decoded?.schoolId).toBeNull();
    expect(decoded?.readOnly).toBe(true);
    expect(decoded?.impersonatedBy).toBeUndefined();

    const row = await prisma.auditLog.findFirst({
      where: { action: "READONLY_SESSION_START", actorId: owner.userId },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row?.actorId).toBe(owner.userId);
    expect(row?.schoolId).toBeNull();
  });

  it("refuses non-owners", async () => {
    const school = await registerSchool(`Ro Refuse School ${uid()}`);
    const res = await request(app)
      .post("/api/v1/platform/read-only-session")
      .set({ Authorization: `Bearer ${school.adminToken}` });
    expect(res.status).toBe(403);
  });

  it("reads work, every write is 403 READ_ONLY_SESSION, no refresh", async () => {
    const school = await registerSchool(`Ro Guard School ${uid()}`);
    const owner = await loginOwner();
    const { status, body } = await mint(owner.token);
    expect(status).toBe(200);
    const roAuth = { Authorization: `Bearer ${data(body).accessToken as string}` };

    // Reads: the platform roster loads.
    await request(app).get("/api/v1/platform/schools").set(roAuth).expect(200);

    // Writes are refused by the SESSION, not the role: the same call with
    // the owner's normal token would reach the handler (a school-less
    // owner token never reaches tenant routes at all — 401 there, exactly
    // like a normal owner token, so the platform write is the proof).
    const platformWrite = await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/suspend`)
      .set(roAuth)
      .send({ reason: "Trying anyway." });
    expect(platformWrite.status).toBe(403);
    expect(platformWrite.body.error.code).toBe("READ_ONLY_SESSION");
    // Nothing suspended on the refusal.
    expect((await prisma.school.findUniqueOrThrow({ where: { id: school.schoolId } })).subscriptionStatus).not.toBe(
      "SUSPENDED",
    );

    // No refresh row was ever minted for it.
    const refresh = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: data(body).accessToken as string });
    expect(refresh.status).toBe(401);
  });

  it("an expired read-only token dies", async () => {
    const owner = await loginOwner();
    const secret = process.env.JWT_ACCESS_SECRET ?? "";
    const dead = jwt.sign(
      { sub: owner.userId, schoolId: null, role: "PLATFORM_OWNER", readOnly: true, type: "access" },
      secret,
      { expiresIn: "-10s" },
    );
    await request(app)
      .get("/api/v1/platform/schools")
      .set({ Authorization: `Bearer ${dead}` })
      .expect(401);
  });
});

describe("read-only sessions at the socket handshake (§13.11)", () => {
  let httpServer: HttpServer;
  let baseUrl = "";

  beforeAll(async () => {
    httpServer = createServer(app);
    initRealtime(httpServer);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("refuses a read-only token with READ_ONLY_SESSION", async () => {
    const school = await registerSchool(`Ro Socket School ${uid()}`);
    const owner = await loginOwner();
    const { status, body } = await mint(owner.token);
    expect(status).toBe(200);
    const err = await new Promise<string>((resolve) => {
      const socket: ClientSocket = clientIo(`${baseUrl}${schoolNamespaceOf(school.schoolId)}`, {
        auth: { token: data(body).accessToken as string },
        reconnection: false,
        timeout: 5000,
      });
      const timer = setTimeout(() => {
        socket.disconnect();
        resolve("TIMEOUT (bad — handshake hung)");
      }, 8000);
      socket.on("ready", () => {
        clearTimeout(timer);
        socket.disconnect();
        resolve("CONNECTED (bad — read-only token joined)");
      });
      socket.on("connect_error", (e: Error) => {
        clearTimeout(timer);
        socket.disconnect();
        resolve(e.message);
      });
    });
    expect(err).toContain("READ_ONLY_SESSION");
  });
});
