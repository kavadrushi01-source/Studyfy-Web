import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import JSZip from "jszip";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { buildExportFiles } from "../src/modules/exports/exports.service.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string; adminEmail: string; adminId: string }> {
  const adminEmail = `export-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Export Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: adminEmail } } });
  return {
    schoolId,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
    adminEmail,
    adminId: admin.id,
  };
}

async function loginOwner(): Promise<{ token: string; userId: string }> {
  const email = `export-owner-${uid()}@example.com`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
  const user = await prisma.user.create({
    data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Export Owner" },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
  return { token: res.body.data.accessToken as string, userId: user.id };
}

async function makeTeacher(schoolId: string, slug: string): Promise<string> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
  const email = `export-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Export Teacher" },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ schoolSlug: slug, email, password })
    .expect(200);
  return login.body.data.accessToken as string;
}

async function download(
  method: "post",
  url: string,
  auth: { Authorization: string },
  body?: Record<string, unknown>,
): Promise<Buffer> {
  const req = request(app)[method](url).set(auth);
  if (body) {
    req.send(body);
  }
  const res = await req.parse((response, callback) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk) => chunks.push(chunk as Buffer));
    response.on("end", () => callback(null, Buffer.concat(chunks)));
  });
  if (res.status !== 200) {
    throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return res.body as Buffer;
}

// Markers are per-school unique strings: presence proves inclusion,
// absence across the boundary proves isolation (ids and all).
async function seedMarkers(prefix: string): Promise<{
  schoolId: string;
  slug: string;
  adminToken: string;
  adminEmail: string;
  adminId: string;
  notice: string;
  ticket: string;
}> {
  const school = await registerSchool(`Export ${prefix} ${uid()}`);
  const auth = { Authorization: `Bearer ${school.adminToken}` };
  const notice = `Export marker notice ${prefix} ${uid()}`;
  await request(app)
    .post(`/api/v1/schools/${school.schoolId}/notices`)
    .set(auth)
    .send({ title: notice, body: "Marker body.", target: "SCHOOL" })
    .expect(201);
  const ticket = `Export marker ticket ${prefix} ${uid()}`;
  await request(app)
    .post(`/api/v1/schools/${school.schoolId}/support/tickets`)
    .set(auth)
    .send({ subject: ticket, priority: "LOW" })
    .expect(201);
  return { ...school, notice, ticket };
}

describe("school data export, builder (§13.10)", () => {
  it("contains only its own school, both ways — rows, ids, and all", async () => {
    const a = await seedMarkers("A");
    const b = await seedMarkers("B");

    const builtA = await buildExportFiles(prisma, a.schoolId);
    const blobA = Object.values(builtA.files).join("\n");
    expect(blobA).toContain(a.notice);
    expect(blobA).toContain(a.ticket);
    expect(blobA).toContain(a.adminEmail);
    expect(blobA).toContain(a.schoolId);
    expect(blobA).not.toContain(b.notice);
    expect(blobA).not.toContain(b.ticket);
    expect(blobA).not.toContain(b.adminEmail);
    expect(blobA).not.toContain(b.schoolId);
    expect(blobA).not.toContain(b.adminId);

    const builtB = await buildExportFiles(prisma, b.schoolId);
    const blobB = Object.values(builtB.files).join("\n");
    expect(blobB).toContain(b.notice);
    expect(blobB).not.toContain(a.notice);
    expect(blobB).not.toContain(a.schoolId);
    expect(blobB).not.toContain(a.adminId);
  });

  it("scans clean for secrets — hashes, token tables, key material", async () => {
    const a = await seedMarkers("Secrets");
    const built = await buildExportFiles(prisma, a.schoolId);
    const blob = Object.values(built.files).join("\n");
    for (const needle of [
      "passwordHash",
      "password_hash",
      "tokenHash",
      "token_hash",
      "apiKeyHash",
      "api_key_hash",
      "$2b$",
      "$2a$",
      "auth_tokens",
      "refresh_tokens",
    ]) {
      expect(blob).not.toContain(needle);
    }
    // No file is even named after the secret tables.
    expect(Object.keys(built.files).some((n) => n.includes("token"))).toBe(false);
    // Users and devices ship, minus their secrets.
    const users = JSON.parse(built.files["users.json"] as string) as Record<string, unknown>[];
    expect(users.length).toBeGreaterThan(0);
    expect(Object.keys(users[0] ?? {})).not.toContain("passwordHash");
  });

  it("excludes internal ticket notes — the support privacy boundary holds", async () => {
    const a = await seedMarkers("Internal");
    const owner = await loginOwner();
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };
    const ticketRow = await prisma.ticket.findFirstOrThrow({ where: { schoolId: a.schoolId } });
    const note = `Export secret triage ${uid()}`;
    const reply = `Export visible reply ${uid()}`;
    await request(app)
      .post(`/api/v1/platform/tickets/${ticketRow.id}/messages`)
      .set(ownerAuth)
      .send({ body: note, isInternal: true })
      .expect(201);
    await request(app)
      .post(`/api/v1/platform/tickets/${ticketRow.id}/messages`)
      .set(ownerAuth)
      .send({ body: reply, isInternal: false })
      .expect(201);

    const built = await buildExportFiles(prisma, a.schoolId);
    const messages = JSON.parse(built.files["ticket_messages.json"] as string) as { body: string }[];
    expect(messages.some((m) => m.body === note)).toBe(false);
    expect(messages.some((m) => m.body === reply)).toBe(true);
  });

  it("404s an unknown school instead of exporting the void", async () => {
    const err = await buildExportFiles(prisma, "school-that-does-not-exist").catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("SCHOOL_NOT_FOUND");
  });
});

describe("school data export, HTTP (§13.10)", () => {
  it("streams a real zip to the admin; cross-tenant and keyless callers fail", async () => {
    const a = await seedMarkers("HttpA");
    const b = await seedMarkers("HttpB");
    const authA = { Authorization: `Bearer ${a.adminToken}` };

    const buf = await download("post", `/api/v1/schools/${a.schoolId}/exports`, authA);
    expect(buf.subarray(0, 4).toString("binary")).toBe("PK\u0003\u0004");
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    expect(names).toContain("manifest.json");
    expect(names).toContain("users.json");
    expect(names).toContain("notices.json");
    expect(names).toContain("tickets.json");
    const manifest = JSON.parse((await zip.files["manifest.json"]?.async("string")) ?? "{}") as {
      school: { slug: string };
      exporterId: string;
      reason: null;
    };
    expect(manifest.school.slug).toBe(a.slug);
    expect(manifest.exporterId).toBe(a.adminId);
    expect(manifest.reason).toBeNull();
    const noticesRaw = (await zip.files["notices.json"]?.async("string")) ?? "[]";
    expect(noticesRaw).toContain(a.notice);
    expect(noticesRaw).not.toContain(b.notice);

    // B's admin on A's URL: tenant mismatch, never the archive.
    const cross = await request(app)
      .post(`/api/v1/schools/${a.schoolId}/exports`)
      .set({ Authorization: `Bearer ${b.adminToken}` });
    expect(cross.status).toBe(403);

    // Teacher holds no exports key.
    const teacherDenied = await request(app)
      .post(`/api/v1/schools/${a.schoolId}/exports`)
      .set({ Authorization: `Bearer ${await makeTeacher(a.schoolId, a.slug)}` });
    expect(teacherDenied.status).toBe(403);
  });

  it("lets the owner export any school with a recorded reason — audited both paths", async () => {
    const a = await seedMarkers("OwnerPath");
    const owner = await loginOwner();
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };

    const noReason = await request(app).post(`/api/v1/platform/schools/${a.schoolId}/exports`).set(ownerAuth).send({});
    expect(noReason.status).toBe(400);

    const buf = await download("post", `/api/v1/platform/schools/${a.schoolId}/exports`, ownerAuth, {
      reason: "Founder support case SUP-2201: hand the school its archive.",
    });
    expect(buf.subarray(0, 4).toString("binary")).toBe("PK\u0003\u0004");
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files)).toContain("manifest.json");

    // Unknown school fails loud, not empty.
    const missing = await request(app)
      .post("/api/v1/platform/schools/school-that-does-not-exist/exports")
      .set(ownerAuth)
      .send({ reason: "Founder support case SUP-2201." });
    expect(missing.status).toBe(404);

    // Non-owners never reach the platform route.
    const adminDenied = await request(app)
      .post(`/api/v1/platform/schools/${a.schoolId}/exports`)
      .set({ Authorization: `Bearer ${a.adminToken}` })
      .send({ reason: "Trying anyway." });
    expect(adminDenied.status).toBe(403);

    const rows = await prisma.auditLog.findMany({ where: { schoolId: a.schoolId, action: "DATA_EXPORT" } });
    const ownerRows = rows.filter((r) => r.actorId === owner.userId);
    expect(ownerRows).toHaveLength(1);
    expect((ownerRows[0]?.after as { reason: string } | null)?.reason).toContain("SUP-2201");
  });

  it("audits the school's own export with actor and null reason", async () => {
    const a = await seedMarkers("AuditSelf");
    await download("post", `/api/v1/schools/${a.schoolId}/exports`, { Authorization: `Bearer ${a.adminToken}` });
    const rows = await prisma.auditLog.findMany({ where: { schoolId: a.schoolId, action: "DATA_EXPORT" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(a.adminId);
    expect(rows[0]?.entity).toBe("Export");
    expect((rows[0]?.after as { reason: null } | null)?.reason).toBeNull();
  });

  it("refuses a suspended school's admin outside the billing/support doorways", async () => {
    const a = await seedMarkers("SuspExport");
    const owner = await loginOwner();
    await request(app)
      .post(`/api/v1/platform/schools/${a.schoolId}/suspend`)
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ reason: "Test suspension" })
      .expect(200);
    const res = await request(app)
      .post(`/api/v1/schools/${a.schoolId}/exports`)
      .set({ Authorization: `Bearer ${a.adminToken}` });
    expect(res.status).toBe(403);
  });
});
