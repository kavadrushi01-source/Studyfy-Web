import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { setDocumentStorage } from "../src/lib/storage.js";
import { DEMO_UPLOAD_MAX_FILES } from "../src/lib/upload-caps.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

// Recording stub: bytes never leave the box, uploads always "succeed".
beforeAll(() => {
  setDocumentStorage({
    upload: async () => ({ url: `https://cdn.example/demo-cap-${uid()}.png`, publicId: `fake-${uid()}` }),
  });
});

afterAll(() => {
  setDocumentStorage(null);
});

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string; adminId: string }> {
  const adminEmail = `cap-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Cap Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: adminEmail } } });
  return { schoolId, slug: res.body.data.school.slug as string, adminToken: res.body.data.accessToken as string, adminId: admin.id };
}

function png(bytes: number): { buffer: Buffer; filename: string; mime: string } {
  return { buffer: Buffer.alloc(bytes, 7), filename: `cap-${uid()}.png`, mime: "image/png" };
}

async function uploadDoc(auth: { Authorization: string }, schoolId: string, ownerId: string, bytes: number) {
  const file = png(bytes);
  return request(app)
    .post(`/api/v1/schools/${schoolId}/documents`)
    .set(auth)
    .field("ownerId", ownerId)
    .field("type", "PHOTO")
    .attach("file", file.buffer, { filename: file.filename, contentType: file.mime });
}

describe("demo upload caps (§13.11)", () => {
  it("caps demo schools at 2 MB per file; real schools keep 5 MB", async () => {
    const demo = await registerSchool(`Cap Demo School ${uid()}`);
    await prisma.school.update({ where: { id: demo.schoolId }, data: { isDemo: true } });
    const auth = { Authorization: `Bearer ${demo.adminToken}` };

    const big = await uploadDoc(auth, demo.schoolId, demo.adminId, 3 * 1024 * 1024);
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe("FILE_TOO_LARGE");
    expect(await prisma.document.count({ where: { schoolId: demo.schoolId } })).toBe(0);

    const ok = await uploadDoc(auth, demo.schoolId, demo.adminId, 1024);
    expect(ok.status).toBe(201);

    // Same 3 MB file at a real school: the §13.5 envelope, not the demo cap.
    const real = await registerSchool(`Cap Real School ${uid()}`);
    const realRes = await uploadDoc(
      { Authorization: `Bearer ${real.adminToken}` },
      real.schoolId,
      real.adminId,
      3 * 1024 * 1024,
    );
    expect(realRes.status).toBe(201);
  });

  it("caps demo schools at 50 stored files; the 51st is refused, real schools unaffected", async () => {
    const demo = await registerSchool(`Cap Count School ${uid()}`);
    await prisma.school.update({ where: { id: demo.schoolId }, data: { isDemo: true } });
    const auth = { Authorization: `Bearer ${demo.adminToken}` };

    for (let i = 0; i < DEMO_UPLOAD_MAX_FILES; i += 1) {
      const res = await uploadDoc(auth, demo.schoolId, demo.adminId, 512);
      expect(res.status).toBe(201);
    }
    const refused = await uploadDoc(auth, demo.schoolId, demo.adminId, 512);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("DEMO_UPLOAD_CAP");
    expect(await prisma.document.count({ where: { schoolId: demo.schoolId } })).toBe(DEMO_UPLOAD_MAX_FILES);
  });

  it("caps ticket screenshots for demo schools on both attach paths", async () => {
    const demo = await registerSchool(`Cap Attach School ${uid()}`);
    await prisma.school.update({ where: { id: demo.schoolId }, data: { isDemo: true } });
    const auth = { Authorization: `Bearer ${demo.adminToken}` };
    const ticket = await request(app)
      .post(`/api/v1/schools/${demo.schoolId}/support/tickets`)
      .set(auth)
      .send({ subject: "Cap attach", priority: "LOW" })
      .expect(201);
    const ticketId = ticket.body.data.id as string;
    const file = png(3 * 1024 * 1024);

    const denied = await request(app)
      .post(`/api/v1/schools/${demo.schoolId}/support/tickets/${ticketId}/attachments`)
      .set(auth)
      .field("message", "Too big for demo.")
      .attach("file", file.buffer, { filename: file.filename, contentType: file.mime });
    expect(denied.status).toBe(413);
    expect(await prisma.ticketAttachment.count({ where: { schoolId: demo.schoolId } })).toBe(0);
  });
});
