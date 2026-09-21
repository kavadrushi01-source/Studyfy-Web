import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { io as clientIo, type Socket as ClientSocket } from "socket.io-client";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { initRealtime, schoolNamespaceOf } from "../src/realtime/server.js";

function uid(): string {
  return randomUUID().slice(0, 8);
}

let httpServer: HttpServer;
let baseUrl = "";

beforeAll(async () => {
  httpServer = createServer(createApp());
  initRealtime(httpServer);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });
  // Watch: vitest may warn about the ws engine's dangling timer; the
  // explicit server close above is the real cleanup.
});

async function registerSchool(): Promise<{ schoolId: string; adminToken: string }> {
  const res = await request(createApp())
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Socket School ${uid()}`,
      adminName: "Socket Admin",
      adminEmail: `socket-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return { schoolId: res.body.data.school.id as string, adminToken: res.body.data.accessToken as string };
}

async function makeOwnerToken(): Promise<string> {
  const email = `socket-owner-${uid()}@example.com`;
  const role = await prisma.role.findUnique({ where: { name: "PLATFORM_OWNER" } });
  if (!role) {
    throw new Error("PLATFORM_OWNER role must be seeded");
  }
  await prisma.user.create({
    data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Owner" },
  });
  const login = await request(createApp())
    .post("/api/v1/auth/login")
    .send({ email, password: "owner-pass-123" })
    .expect(200);
  return login.body.data.accessToken as string;
}

function connect(
  namespace: string,
  token?: string,
): Promise<{ socket: ClientSocket; ready: unknown; error: string | null }> {
  return new Promise((resolve) => {
    const socket = clientIo(`${baseUrl}${namespace}`, {
      auth: token === undefined ? {} : { token },
      reconnection: false,
      timeout: 5000,
    });
    const done = (ready: unknown, error: string | null): void => {
      socket.removeAllListeners();
      resolve({ socket, ready, error });
    };
    const timer = setTimeout(() => done(null, "client timeout waiting for handshake"), 8000);
    socket.on("ready", (payload: unknown) => {
      clearTimeout(timer);
      done(payload, null);
    });
    socket.on("connect_error", (err: Error) => {
      clearTimeout(timer);
      done(null, err.message);
    });
  });
}

describe("Socket.io handshake (§12.5)", () => {
  it("connects a valid token to its own school namespace with identity", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const { socket, ready, error } = await connect(schoolNamespaceOf(schoolId), adminToken);
    socket.disconnect();
    expect(error).toBeNull();
    expect(ready).toMatchObject({ schoolId, role: "SCHOOL_ADMIN" });
  });

  it("rejects a valid token on another school's namespace", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const { socket, ready, error } = await connect(schoolNamespaceOf(schoolB.schoolId), schoolA.adminToken);
    socket.disconnect();
    expect(ready).toBeNull();
    expect(error).toBe("Namespace does not match your school.");
  });

  it("rejects missing, garbage, and school-less tokens", async () => {
    const { schoolId } = await registerSchool();
    const ownerToken = await makeOwnerToken();

    const missing = await connect(schoolNamespaceOf(schoolId));
    missing.socket.disconnect();
    expect(missing.ready).toBeNull();
    expect(missing.error).toBe("Invalid or expired token.");

    const garbage = await connect(schoolNamespaceOf(schoolId), "not-a-token");
    garbage.socket.disconnect();
    expect(garbage.ready).toBeNull();
    expect(garbage.error).toBe("Invalid or expired token.");

    const owner = await connect(schoolNamespaceOf(schoolId), ownerToken);
    owner.socket.disconnect();
    expect(owner.ready).toBeNull();
    expect(owner.error).toBe("No school context.");
  });
});
