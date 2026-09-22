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

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

let httpServer: HttpServer;
let baseUrl = "";

beforeAll(async () => {
  httpServer = createServer(app);
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
});

async function registerSchool(): Promise<{ schoolId: string; slug: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Live Chat School ${uid()}`,
      adminName: "Live Chat Admin",
      adminEmail: `live-chat-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return { schoolId: res.body.data.school.id as string, slug: res.body.data.school.slug as string };
}

async function makeUser(
  schoolId: string,
  slug: string,
  roleName: string,
): Promise<{ token: string; userId: string }> {
  const email = `live-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "user-pass-123";
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`${roleName} role must be seeded`);
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} User` },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id };
}

function connect(namespace: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = clientIo(`${baseUrl}${namespace}`, {
      auth: { token },
      reconnection: false,
      timeout: 5000,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error("client timeout waiting for handshake"));
    }, 8000);
    socket.on("ready", () => {
      clearTimeout(timer);
      socket.removeAllListeners("ready");
      resolve(socket);
    });
    socket.on("connect_error", (err: Error) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(err);
    });
  });
}

function waitForMessageNew(socket: ClientSocket): Promise<{ threadId: string; message: { senderId: string; body: string } }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeAllListeners("message:new");
      reject(new Error("timed out waiting for message:new"));
    }, 8000);
    socket.on("message:new", (payload: { threadId: string; message: { senderId: string; body: string } }) => {
      clearTimeout(timer);
      socket.removeAllListeners("message:new");
      resolve(payload);
    });
  });
}

describe("live message:new delivery (§12.5 + §13.7)", () => {
  it("pushes a sent message to the school room over the socket, not just HTTP", async () => {
    const { schoolId, slug } = await registerSchool();
    const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
    const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
    const subject = await prisma.subject.create({ data: { schoolId, name: `Subject ${uid()}`, group: "Core" } });

    const teacher = await makeUser(schoolId, slug, "TEACHER");
    const staff = await prisma.staff.create({ data: { schoolId, userId: teacher.userId, designation: "Teacher" } });
    await prisma.section.update({ where: { id: section.id }, data: { classTeacherId: staff.id } });
    await prisma.teacherSubject.create({ data: { schoolId, staffId: staff.id, subjectId: subject.id } });

    const pupil = await makeUser(schoolId, slug, "STUDENT");
    await prisma.student.create({ data: { schoolId, userId: pupil.userId, sectionId: section.id } });

    // Teacher's live client joins the school room; the pupil sends over HTTP.
    const socket = await connect(schoolNamespaceOf(schoolId), teacher.token);
    try {
      const delivered = waitForMessageNew(socket);
      const sent = await request(app)
        .post(`/api/v1/schools/${schoolId}/messages`)
        .set("Authorization", `Bearer ${pupil.token}`)
        .send({ receiverId: teacher.userId, body: "Live check: chapter 3 done." })
        .expect(201);
      const event = await delivered;
      expect(event.threadId).toBe(sent.body.data.message.threadId as string);
      expect(event.message.senderId).toBe(pupil.userId);
      expect(event.message.body).toBe("Live check: chapter 3 done.");
    } finally {
      socket.disconnect();
    }
  }, 30000);
});
