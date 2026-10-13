import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { setDocumentStorage } from "../src/lib/storage.js";

const app = createApp();
const savedCloudinary = process.env.CLOUDINARY_URL;

function uid(): string {
  return randomUUID().slice(0, 8);
}

// Recording stub: asserts the tenant folder without touching Cloudinary.
const uploads: { folder: string; schoolId: string; mimeType: string }[] = [];

function installStub(): void {
  setDocumentStorage({
    upload: async (input) => {
      const folder = `schools/${input.schoolId}/tickets`;
      uploads.push({ folder, schoolId: input.schoolId, mimeType: input.mimeType });
      return { url: `https://cdn.example/${folder}/fake-${uid()}.png`, publicId: `fake-${uid()}` };
    },
  });
}

beforeAll(() => {
  installStub();
});

afterAll(() => {
  setDocumentStorage(null);
  if (savedCloudinary === undefined) {
    delete process.env.CLOUDINARY_URL;
  } else {
    process.env.CLOUDINARY_URL = savedCloudinary;
  }
});

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string; adminEmail: string }> {
  const adminEmail = `support-attach-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Support Attach Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
    adminEmail,
  };
}

async function loginOwner(): Promise<string> {
  const email = `support-attach-owner-${uid()}@example.com`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
  await prisma.user.create({
    data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Support Attach Owner" },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
  return res.body.data.accessToken as string;
}

function png(bytes = 1024): { buffer: Buffer; filename: string; mime: string } {
  return { buffer: Buffer.alloc(bytes, 7), filename: `shot-${uid()}.png`, mime: "image/png" };
}

describe("ticket attachments (§7 #27, §13.5)", () => {
  it("attaches a screenshot to a visible reply under the tenant folder", async () => {
    const school = await registerSchool(`Support Attach School ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const ticket = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets`)
      .set(auth)
      .send({ subject: "Screen glitch on roster", priority: "HIGH" })
      .expect(201);
    const ticketId = ticket.body.data.id as string;

    const file = png();
    const res = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}/attachments`)
      .set(auth)
      .field("message", "See the glitch top-right.")
      .attach("file", file.buffer, { filename: file.filename, contentType: file.mime })
      .expect(201);

    // Tenant folder claimed at upload time (stub records, never Cloudinary).
    const last = uploads[uploads.length - 1];
    expect(last?.folder).toBe(`schools/${school.schoolId}/tickets`);
    expect(last?.mimeType).toBe("image/png");

    const detail = await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}`).set(auth).expect(200);
    const messages = detail.body.data.ticket.messages as { body: string; isInternal: boolean; attachments: { url: string; mimeType: string; originalName: string }[] }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.body).toBe("See the glitch top-right.");
    expect(messages[0]?.attachments).toHaveLength(1);
    expect(messages[0]?.attachments[0]?.mimeType).toBe("image/png");
    expect(messages[0]?.attachments[0]?.originalName).toBe(file.filename);

    const row = await prisma.ticketAttachment.findFirstOrThrow({ where: { schoolId: school.schoolId } });
    expect(row.ticketId).toBe(ticketId);
    const audit = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "TICKET_MESSAGE" } });
    expect(audit).toHaveLength(1);
    expect(res.body.data.id).toBeTruthy();
  });

  it("rejects bad files loudly: type, size, missing", async () => {
    const school = await registerSchool(`Support Attach Files School ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const ticket = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets`)
      .set(auth)
      .send({ subject: "Bad files", priority: "LOW" })
      .expect(201);
    const ticketId = ticket.body.data.id as string;
    const url = `/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}/attachments`;

    const txt = await request(app).post(url).set(auth).attach("file", Buffer.from("hello"), { filename: "note.txt", contentType: "text/plain" });
    expect(txt.status).toBe(415);
    const big = await request(app)
      .post(url)
      .set(auth)
      .attach("file", Buffer.alloc(5 * 1024 * 1024 + 1, 7), { filename: "big.png", contentType: "image/png" });
    expect(big.status).toBe(413);
    const missing = await request(app).post(url).set(auth).field("message", "no file");
    expect(missing.status).toBe(400);
    // Nothing stored on any refusal.
    expect(await prisma.ticketAttachment.count({ where: { schoolId: school.schoolId } })).toBe(0);
  });

  it("isolates tenants and roles on attachments", async () => {
    const a = await registerSchool(`Support Attach A ${uid()}`);
    const b = await registerSchool(`Support Attach B ${uid()}`);
    const ticket = await request(app)
      .post(`/api/v1/schools/${a.schoolId}/support/tickets`)
      .set({ Authorization: `Bearer ${a.adminToken}` })
      .send({ subject: "Private screenshot", priority: "MEDIUM" })
      .expect(201);
    const ticketId = ticket.body.data.id as string;
    const file = png();

    // Stranger-school token on A's ticket: scoped 404, no upload happened.
    const cross = await request(app)
      .post(`/api/v1/schools/${b.schoolId}/support/tickets/${ticketId}/attachments`)
      .set({ Authorization: `Bearer ${b.adminToken}` })
      .field("message", "Hijack.")
      .attach("file", file.buffer, { filename: file.filename, contentType: file.mime });
    expect(cross.status).toBe(404);

    // Teacher holds no support key.
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
    const teacherEmail = `support-attach-teacher-${uid()}@example.com`;
    const teacher = await prisma.user.create({
      data: { schoolId: a.schoolId, roleId: role.id, email: teacherEmail, passwordHash: await bcrypt.hash("teacher-pass-123", 4), name: "T" },
    });
    await prisma.staff.create({ data: { schoolId: a.schoolId, userId: teacher.id, designation: "Teacher" } });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ schoolSlug: a.slug, email: teacherEmail, password: "teacher-pass-123" })
      .expect(200);
    const denied = await request(app)
      .post(`/api/v1/schools/${a.schoolId}/support/tickets/${ticketId}/attachments`)
      .set({ Authorization: `Bearer ${login.body.data.accessToken as string}` })
      .field("message", "Nope.")
      .attach("file", file.buffer, { filename: file.filename, contentType: file.mime });
    expect(denied.status).toBe(403);
    expect(await prisma.ticketAttachment.count({ where: { schoolId: a.schoolId } })).toBe(0);
  });

  it("serves a suspended admin's attachment; hides owner-internal ones", async () => {
    const school = await registerSchool(`Support Attach Suspended ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const ownerToken = await loginOwner();
    const ownerAuth = { Authorization: `Bearer ${ownerToken}` };
    const ticket = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets`)
      .set(auth)
      .send({ subject: "Suspended help", priority: "HIGH" })
      .expect(201);
    const ticketId = ticket.body.data.id as string;

    await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/suspend`)
      .set(ownerAuth)
      .send({ reason: "Test suspension" })
      .expect(200);
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ schoolSlug: school.slug, email: school.adminEmail, password: "password-123" })
      .expect(200);
    const suspAuth = { Authorization: `Bearer ${adminLogin.body.data.accessToken as string}` };
    const file = png();
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}/attachments`)
      .set(suspAuth)
      .field("message", "Still broken, proof attached.")
      .attach("file", file.buffer, { filename: file.filename, contentType: file.mime })
      .expect(201);

    // Owner internal attachment with a screenshot rides the same pipe.
    const ownerFile = png();
    await request(app)
      .post(`/api/v1/platform/tickets/${ticketId}/attachments`)
      .set(ownerAuth)
      .field("message", "Internal diagnosis.")
      .field("isInternal", "true")
      .attach("file", ownerFile.buffer, { filename: ownerFile.filename, contentType: ownerFile.mime })
      .expect(201);

    const schoolView = await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}`).set(suspAuth).expect(200);
    const seen = schoolView.body.data.ticket.messages as { body: string; attachments: unknown[] }[];
    expect(seen).toHaveLength(1);
    expect(seen[0]?.attachments).toHaveLength(1);

    const ownerView = await request(app).get(`/api/v1/platform/tickets/${ticketId}`).set(ownerAuth).expect(200);
    expect(ownerView.body.data.ticket.messages).toHaveLength(2);
  });

  it("returns 503 when storage is unconfigured", async () => {
    const school = await registerSchool(`Support Attach Unconfigured ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const ticket = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets`)
      .set(auth)
      .send({ subject: "No storage", priority: "LOW" })
      .expect(201);
    const ticketId = ticket.body.data.id as string;

    setDocumentStorage(null);
    delete process.env.CLOUDINARY_URL;
    try {
      const file = png();
      const res = await request(app)
        .post(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}/attachments`)
        .set(auth)
        .field("message", "Nowhere to store.")
        .attach("file", file.buffer, { filename: file.filename, contentType: file.mime });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("STORAGE_UNCONFIGURED");
    } finally {
      installStub();
    }
  });
});
