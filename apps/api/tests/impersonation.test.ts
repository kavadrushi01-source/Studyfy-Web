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
import { blockWritesWhenReadOnlySession } from "../src/middleware/read-only.js";
import { formatRequestLog } from "../src/middleware/request-log.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

const REASON = "Support ticket SUP-1042: fee receipt mismatch, reproduce as staff";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string; adminId: string }> {
  const adminEmail = `imp-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Imp Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: adminEmail } } });
  return {
    schoolId,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
    adminId: admin.id,
  };
}

async function loginOwner(): Promise<{ token: string; userId: string }> {
  const email = `imp-owner-${uid()}@example.com`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
  const user = await prisma.user.create({
    data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Imp Owner" },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
  return { token: res.body.data.accessToken as string, userId: user.id };
}

// Staff target that CAN log in (staff row), for control reads.
async function makeStaff(
  schoolId: string,
  slug: string,
  roleName: string,
): Promise<{ token: string; userId: string; email: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const email = `imp-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "staff-pass-123";
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `Imp ${roleName}` },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: roleName } });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ schoolSlug: slug, email, password })
    .expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id, email };
}

// Bare user row (never logs in — targets don't need to).
async function makeBareUser(schoolId: string | null, roleName: string): Promise<string> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: `imp-bare-${roleName.toLowerCase()}-${uid()}@example.com`,
      passwordHash: await bcrypt.hash("x", 4),
      name: `Bare ${roleName}`,
    },
  });
  return user.id;
}

async function impersonate(
  ownerToken: string,
  targetUserId: string,
  reason: string = REASON,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request(app)
    .post("/api/v1/platform/impersonate")
    .set({ Authorization: `Bearer ${ownerToken}` })
    .send({ targetUserId, reason });
  return { status: res.status, body: res.body as Record<string, unknown> };
}

function data(body: Record<string, unknown>): Record<string, unknown> {
  return body.data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// POST /platform/impersonate — issue
// ---------------------------------------------------------------------------

describe("POST /platform/impersonate (§13.9)", () => {
  it("issues a 30-minute token with no refresh, and writes START", async () => {
    const school = await registerSchool(`Imp School ${uid()}`);
    const owner = await loginOwner();
    const teacher = await makeStaff(school.schoolId, school.slug, "TEACHER");

    const { status, body } = await impersonate(owner.token, teacher.userId);
    expect(status).toBe(200);
    const d = data(body);
    expect(typeof d.accessToken).toBe("string");
    expect(d.refreshToken).toBeUndefined();
    expect(typeof d.sessionId).toBe("string");
    expect(typeof d.expiresAt).toBe("string");
    const ttlMs = Date.parse(d.expiresAt as string) - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60 * 1000);
    expect(d.target).toMatchObject({ id: teacher.userId, role: "TEACHER", schoolId: school.schoolId });

    const decoded = jwt.decode(d.accessToken as string) as Record<string, unknown> | null;
    expect(decoded?.sub).toBe(teacher.userId);
    expect(decoded?.role).toBe("TEACHER");
    expect(decoded?.schoolId).toBe(school.schoolId);
    expect(decoded?.impersonatedBy).toBe(owner.userId);
    expect(decoded?.jti).toBe(d.sessionId);
    expect(((decoded?.exp as number) - (decoded?.iat as number)) / 60).toBe(30);

    const start = await prisma.auditLog.findFirst({
      where: { action: "IMPERSONATION_START", entityId: d.sessionId as string },
    });
    expect(start).not.toBeNull();
    expect(start?.actorId).toBe(owner.userId);
    expect(start?.schoolId).toBe(school.schoolId);
    expect(start?.entity).toBe("Impersonation");
    const after = start?.after as Record<string, unknown> | null;
    expect(after?.targetUserId).toBe(teacher.userId);
    expect(after?.targetRole).toBe("TEACHER");
    expect(after?.ownerId).toBe(owner.userId);
    expect(after?.reason).toBe(REASON);
  });

  it("refuses students, parents, owners, deactivated users, suspended schools — and bad input", async () => {
    const school = await registerSchool(`Imp Refuse School ${uid()}`);
    const owner = await loginOwner();
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };

    expect((await impersonate(owner.token, await makeBareUser(school.schoolId, "STUDENT"))).status).toBe(403);
    expect((await impersonate(owner.token, await makeBareUser(school.schoolId, "PARENT"))).status).toBe(403);
    const secondOwner = await loginOwner();
    expect((await impersonate(owner.token, secondOwner.userId)).status).toBe(403);

    const teacher = await makeStaff(school.schoolId, school.slug, "TEACHER");
    await prisma.user.update({ where: { id: teacher.userId }, data: { isActive: false } });
    expect((await impersonate(owner.token, teacher.userId)).status).toBe(403);

    // Suspended school: reactivate-first per spec.
    const other = await registerSchool(`Imp Susp School ${uid()}`);
    const target = await makeStaff(other.schoolId, other.slug, "ACCOUNTANT");
    await request(app)
      .post(`/api/v1/platform/schools/${other.schoolId}/suspend`)
      .set(ownerAuth)
      .send({ reason: "Test suspension" })
      .expect(200);
    expect((await impersonate(owner.token, target.userId)).status).toBe(403);

    // Unknown id, missing/short reason, non-owner caller, nested session.
    expect((await impersonate(owner.token, "user-that-does-not-exist")).status).toBe(404);
    expect(
      (
        await request(app)
          .post("/api/v1/platform/impersonate")
          .set(ownerAuth)
          .send({ targetUserId: target.userId })
      ).status,
    ).toBe(400);
    expect((await impersonate(owner.token, target.userId, "short")).status).toBe(400);
    const adminImpersonate = await request(app)
      .post("/api/v1/platform/impersonate")
      .set({ Authorization: `Bearer ${school.adminToken}` })
      .send({ targetUserId: target.userId, reason: REASON });
    expect(adminImpersonate.status).toBe(403);

    const admin = await makeStaff(school.schoolId, school.slug, "SCHOOL_ADMIN");
    const nested = await impersonate(owner.token, admin.userId);
    expect(nested.status).toBe(200);
    const nestedCall = await request(app)
      .post("/api/v1/platform/impersonate")
      .set({ Authorization: `Bearer ${data(nested.body).accessToken as string}` })
      .send({ targetUserId: target.userId, reason: REASON });
    expect(nestedCall.status).toBe(403);
  });

  it("a read as the target works; any write is 403 READ_ONLY_SESSION", async () => {
    const school = await registerSchool(`Imp Readonly School ${uid()}`);
    const owner = await loginOwner();
    const teacher = await makeStaff(school.schoolId, school.slug, "TEACHER");
    const started = await impersonate(owner.token, teacher.userId);
    expect(started.status).toBe(200);
    const impAuth = { Authorization: `Bearer ${data(started.body).accessToken as string}` };

    // Read as the teacher: the notice board loads exactly as for them.
    const board = await request(app).get(`/api/v1/schools/${school.schoolId}/notices`).set(impAuth).expect(200);
    expect(Array.isArray((board.body.data as { notices: unknown[] }).notices)).toBe(true);

    // Write as the teacher: rejected before any row exists.
    const blocked = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/notices`)
      .set(impAuth)
      .send({ title: "Sneaky notice", body: "Should never land.", target: "SCHOOL" })
      .expect(403);
    expect(blocked.body.error.code).toBe("READ_ONLY_SESSION");
    expect(await prisma.notice.count({ where: { schoolId: school.schoolId } })).toBe(0);

    // Control: the teacher's own token still writes (guard keys on the
    // claim, not the user).
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/notices`)
      .set({ Authorization: `Bearer ${teacher.token}` })
      .send({ title: "Real notice", body: "Control row.", target: "SCHOOL" })
      .expect(201);
  });

  it("an impersonation token cannot mint a refresh token", async () => {
    const school = await registerSchool(`Imp Refresh School ${uid()}`);
    const owner = await loginOwner();
    const teacher = await makeStaff(school.schoolId, school.slug, "TEACHER");
    const started = await impersonate(owner.token, teacher.userId);
    expect(started.status).toBe(200);

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: data(started.body).accessToken as string });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Socket handshake
// ---------------------------------------------------------------------------

describe("impersonation at the Socket.io handshake (§13.9)", () => {
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

  function connect(namespace: string, token: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const socket = clientIo(`${baseUrl}${namespace}`, { auth: { token }, reconnection: false, timeout: 5000 });
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

  it("refuses an impersonation token; the teacher's own token connects", async () => {
    const school = await registerSchool(`Imp Socket School ${uid()}`);
    const owner = await loginOwner();
    const teacher = await makeStaff(school.schoolId, school.slug, "TEACHER");
    const started = await impersonate(owner.token, teacher.userId);
    expect(started.status).toBe(200);

    // Control first: the real token joins the school room.
    const control = await connect(schoolNamespaceOf(school.schoolId), teacher.token);
    control.disconnect();

    // The impersonation token dies in the handshake — otherwise the owner
    // could send messages as the teacher to a child.
    await expect(connect(schoolNamespaceOf(school.schoolId), data(started.body).accessToken as string)).rejects.toThrow(
      /READ_ONLY_SESSION/,
    );
  });
});

// ---------------------------------------------------------------------------
// Read receipts
// ---------------------------------------------------------------------------

describe("read receipts under impersonation (§13.9)", () => {
  it("a thread read marks readAt normally — but never under impersonation", async () => {
    const school = await registerSchool(`Imp Receipt School ${uid()}`);
    const owner = await loginOwner();
    const teacher = await makeStaff(school.schoolId, school.slug, "TEACHER");
    const teacherAuth = { Authorization: `Bearer ${teacher.token}` };

    // Linked pupil → teacher (the §13.7 matrix's allowed incoming edge):
    // class + section + subject + class-teacher link, mirroring the
    // realtime fixture.
    const cls = await prisma.class.create({ data: { schoolId: school.schoolId, name: `Class ${uid()}` } });
    const section = await prisma.section.create({ data: { schoolId: school.schoolId, classId: cls.id, name: "A" } });
    const subject = await prisma.subject.create({ data: { schoolId: school.schoolId, name: `Subject ${uid()}`, group: "Core" } });
    // makeStaff already enrolled the staffer row — reuse it for the link.
    const staff = await prisma.staff.findFirstOrThrow({ where: { userId: teacher.userId } });
    await prisma.section.update({ where: { id: section.id }, data: { classTeacherId: staff.id } });
    await prisma.teacherSubject.create({ data: { schoolId: school.schoolId, staffId: staff.id, subjectId: subject.id } });
    const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
    const pupilEmail = `imp-pupil-${uid()}@example.com`;
    const pupilUser = await prisma.user.create({
      data: {
        schoolId: school.schoolId,
        roleId: studentRole.id,
        email: pupilEmail,
        passwordHash: await bcrypt.hash("pupil-pass-123", 4),
        name: "Imp Pupil",
      },
    });
    await prisma.student.create({ data: { schoolId: school.schoolId, userId: pupilUser.id, sectionId: section.id } });
    const pupilLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ schoolSlug: school.slug, email: pupilEmail, password: "pupil-pass-123" })
      .expect(200);
    const pupilAuth = { Authorization: `Bearer ${pupilLogin.body.data.accessToken as string}` };

    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/messages`)
      .set(pupilAuth)
      .send({ receiverId: teacher.userId, body: "Please confirm the lab roster." })
      .expect(201);

    // Normal read records the receipt…
    await request(app)
      .get(`/api/v1/schools/${school.schoolId}/messages`)
      .set(teacherAuth)
      .query({ with: pupilUser.id })
      .expect(200);
    expect(
      await prisma.message.count({ where: { schoolId: school.schoolId, receiverId: teacher.userId, readAt: null } }),
    ).toBe(0);

    // …impersonated read does not.
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/messages`)
      .set(pupilAuth)
      .send({ receiverId: teacher.userId, body: "Second note, still unread." })
      .expect(201);
    const started = await impersonate(owner.token, teacher.userId);
    expect(started.status).toBe(200);
    await request(app)
      .get(`/api/v1/schools/${school.schoolId}/messages`)
      .set({ Authorization: `Bearer ${data(started.body).accessToken as string}` })
      .query({ with: pupilUser.id })
      .expect(200);
    expect(
      await prisma.message.count({ where: { schoolId: school.schoolId, receiverId: teacher.userId, readAt: null } }),
    ).toBe(1);
  });

  it("a notice board read under impersonation succeeds and records nothing", async () => {
    const school = await registerSchool(`Imp Notice School ${uid()}`);
    const owner = await loginOwner();
    const teacher = await makeStaff(school.schoolId, school.slug, "TEACHER");
    const started = await impersonate(owner.token, teacher.userId);
    expect(started.status).toBe(200);
    const impAuth = { Authorization: `Bearer ${data(started.body).accessToken as string}` };

    const auditsBefore = await prisma.auditLog.count({ where: { schoolId: school.schoolId } });
    const messagesBefore = await prisma.message.count({ where: { schoolId: school.schoolId } });
    await request(app).get(`/api/v1/schools/${school.schoolId}/notices`).set(impAuth).expect(200);
    // Notices carry no receipt mechanism at all — the read is pure, and
    // impersonation must never be the commit that invents one.
    expect(await prisma.auditLog.count({ where: { schoolId: school.schoolId } })).toBe(auditsBefore);
    expect(await prisma.message.count({ where: { schoolId: school.schoolId } })).toBe(messagesBefore);
  });
});

// ---------------------------------------------------------------------------
// Expiry + END
// ---------------------------------------------------------------------------

describe("impersonation expiry and END (§13.9)", () => {
  it("an expired impersonation token dies like any expired token", async () => {
    const school = await registerSchool(`Imp Expiry School ${uid()}`);
    const owner = await loginOwner();
    const teacher = await makeStaff(school.schoolId, school.slug, "TEACHER");
    const secret = process.env.JWT_ACCESS_SECRET ?? "";
    const dead = jwt.sign(
      {
        sub: teacher.userId,
        schoolId: school.schoolId,
        role: "TEACHER",
        impersonatedBy: owner.userId,
        type: "access",
      },
      secret,
      { expiresIn: "-10s" },
    );
    await request(app)
      .get(`/api/v1/schools/${school.schoolId}/notices`)
      .set({ Authorization: `Bearer ${dead}` })
      .expect(401);
  });

  it("END writes the END row; unknown and double ends fail loud", async () => {
    const school = await registerSchool(`Imp End School ${uid()}`);
    const owner = await loginOwner();
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };
    const teacher = await makeStaff(school.schoolId, school.slug, "TEACHER");
    const started = await impersonate(owner.token, teacher.userId);
    expect(started.status).toBe(200);
    const sessionId = data(started.body).sessionId as string;

    const ended = await request(app).post("/api/v1/platform/impersonate/end").set(ownerAuth).send({ sessionId });
    expect(ended.status).toBe(200);
    const endRow = await prisma.auditLog.findFirst({ where: { action: "IMPERSONATION_END", entityId: sessionId } });
    expect(endRow).not.toBeNull();
    expect(endRow?.actorId).toBe(owner.userId);
    expect(endRow?.schoolId).toBe(school.schoolId);

    const again = await request(app).post("/api/v1/platform/impersonate/end").set(ownerAuth).send({ sessionId });
    expect(again.status).toBe(409);
    const unknown = await request(app)
      .post("/api/v1/platform/impersonate/end")
      .set(ownerAuth)
      .send({ sessionId: "sess-that-never-existed" });
    expect(unknown.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Request log traceability
// ---------------------------------------------------------------------------

describe("request log carries impersonatedBy (§13.9)", () => {
  it("formats the impersonator on the line, '-' otherwise", () => {
    const withImp = formatRequestLog(
      { method: "POST", path: "/api/v1/schools/x/attendance", user: { userId: "teacher-1", impersonatedBy: "owner-9" } },
      403,
      12,
    );
    expect(withImp).toContain("imp=owner-9");
    expect(withImp).toContain("POST");
    expect(withImp).toContain("403");
    const plain = formatRequestLog({ method: "GET", path: "/api/v1/schools/x/notices", user: { userId: "t-1" } }, 200, 3);
    expect(plain).toContain("imp=-");
    expect(plain).not.toContain("undefined");
  });

  it("a real impersonated request logs the claim (production-mode probe)", async () => {
    const school = await registerSchool(`Imp Log School ${uid()}`);
    const owner = await loginOwner();
    const teacher = await makeStaff(school.schoolId, school.slug, "TEACHER");
    const started = await impersonate(owner.token, teacher.userId);
    expect(started.status).toBe(200);

    // The logger skips NODE_ENV=test (suite-noise guard, same precedent as
    // the rate limiters) — flip per-request env around one call only.
    // NOTE: vi.spyOn(console, "log") captures nothing in this file's worker
    // (proven by a sync marker: spy records zero calls while a manual
    // replacement records everything — same pattern works in mail-demo's
    // worker, so this is environment-specific, not a code bug). Manual
    // replacement with restore is the honest probe here.
    const savedEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const captured: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      captured.push(String(args[0] ?? ""));
    };
    try {
      await request(app)
        .get(`/api/v1/schools/${school.schoolId}/notices`)
        .set({ Authorization: `Bearer ${data(started.body).accessToken as string}` })
        .expect(200);
      // Server-side 'finish' can land just after the client resolves —
      // yield before reading the capture.
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      console.log = originalLog;
      if (savedEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = savedEnv;
      }
    }
    expect(captured.some((l) => l.includes(`imp=${owner.userId}`))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guard units (§5.3 shape)
// ---------------------------------------------------------------------------

describe("blockWritesWhenReadOnlySession (§5.3)", () => {
  function run(method: string, impersonatedBy?: string): { status?: number; body?: unknown; next: boolean } {
    let status: number | undefined;
    let body: unknown;
    let next = false;
    const req = { method, user: impersonatedBy ? { userId: "u", impersonatedBy } : { userId: "u" } } as Parameters<
      typeof blockWritesWhenReadOnlySession
    >[0];
    const res = {
      status: (code: number) => {
        status = code;
        return { json: (payload: unknown) => (body = payload) };
      },
    } as unknown as Parameters<typeof blockWritesWhenReadOnlySession>[1];
    blockWritesWhenReadOnlySession(req, res, () => {
      next = true;
    });
    return { status, body, next };
  }

  it.each(["GET", "HEAD", "OPTIONS"])("lets %s through, even impersonated", (method) => {
    const r = run(method, "owner-1");
    expect(r.next).toBe(true);
    expect(r.status).toBeUndefined();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("blocks %s with 403 READ_ONLY_SESSION when impersonated", (method) => {
    const r = run(method, "owner-1");
    expect(r.next).toBe(false);
    expect(r.status).toBe(403);
    expect((r.body as { error: { code: string } }).error.code).toBe("READ_ONLY_SESSION");
  });

  it("lets normal sessions write", () => {
    const r = run("POST");
    expect(r.next).toBe(true);
  });
});
