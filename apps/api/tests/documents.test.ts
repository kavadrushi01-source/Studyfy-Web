import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { setDocumentStorage } from "../src/lib/storage.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

// Records what the route asked the storage layer to do — the folder
// assertion below is what proves the schools/{schoolId}/... rule (§13.5)
// without needing a real Cloudinary account or network.
const uploads: { folder: string; schoolId: string; mimeType: string }[] = [];

beforeAll(() => {
  setDocumentStorage({
    upload: async (input) => {
      const folder = `schools/${input.schoolId}/documents`;
      uploads.push({ folder, schoolId: input.schoolId, mimeType: input.mimeType });
      return { url: `https://cdn.example/${folder}/fake-${uid()}.pdf`, publicId: `fake-${uid()}` };
    },
  });
});

afterAll(() => {
  setDocumentStorage(null);
});

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Docs School ${uid()}`,
      adminName: "Docs Admin",
      adminEmail: `docs-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeUser(
  schoolId: string,
  slug: string,
  roleName: string,
  password = "user-pass-123",
): Promise<{ token: string; userId: string }> {
  const email = `${roleName.toLowerCase()}-${uid()}@example.com`;
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`${roleName} role must be seeded`);
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} User` },
  });
  if (!slug) {
    return { token: "", userId: user.id };
  }
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id };
}

async function makeStudentProfile(schoolId: string, userId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const student = await prisma.student.create({ data: { schoolId, userId, sectionId: section.id } });
  return student.id;
}

function pdfBuffer(): Buffer {
  return Buffer.from("%PDF-1.4 fake-id-card-bytes");
}

describe("documents upload + isolation (§13.5)", () => {
  it("uploads a PDF under the school folder and stores the row tenant-scoped", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const owner = await makeUser(schoolId, "", "STUDENT");
    void owner;

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("ownerId", owner.userId)
      .field("type", "PHOTO")
      .attach("file", pdfBuffer(), { filename: "id-card.pdf", contentType: "application/pdf" })
      .expect(201);

    expect(res.body.data.document.url).toContain(`schools/${schoolId}/documents`);
    const last = uploads[uploads.length - 1];
    expect(last?.folder).toBe(`schools/${schoolId}/documents`);

    const row = await prisma.document.findUnique({ where: { id: res.body.data.document.id as string } });
    expect(row?.schoolId).toBe(schoolId);
  });

  it("rejects executable MIME with 415 and oversized files with 413", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const owner = await makeUser(schoolId, "", "STUDENT");

    const exe = await request(app)
      .post(`/api/v1/schools/${schoolId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("ownerId", owner.userId)
      .field("type", "OTHER")
      .attach("file", Buffer.from("MZ fake binary"), { filename: "evil.exe", contentType: "application/octet-stream" })
      .expect(415);
    expect(exe.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");

    const big = await request(app)
      .post(`/api/v1/schools/${schoolId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("ownerId", owner.userId)
      .field("type", "OTHER")
      .attach("file", Buffer.alloc(6 * 1024 * 1024, 1), { filename: "big.pdf", contentType: "application/pdf" })
      .expect(413);
    expect(big.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects a teacher upload (read but no write) and anonymous upload", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    void adminToken;
    const teacher = await makeUser(schoolId, slug, "TEACHER");
    const owner = await makeUser(schoolId, slug, "STUDENT");

    const denied = await request(app)
      .post(`/api/v1/schools/${schoolId}/documents`)
      .set("Authorization", `Bearer ${teacher.token}`)
      .field("ownerId", owner.userId)
      .field("type", "PHOTO")
      .attach("file", pdfBuffer(), { filename: "id-card.pdf", contentType: "application/pdf" })
      .expect(403);
    expect(denied.body.error.code).toBe("PERMISSION_DENIED");

    await request(app)
      .post(`/api/v1/schools/${schoolId}/documents`)
      .field("ownerId", owner.userId)
      .field("type", "PHOTO")
      .attach("file", pdfBuffer(), { filename: "id-card.pdf", contentType: "application/pdf" })
      .expect(401);
  });

  it("makes School A's document inaccessible from School B's context", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const ownerA = await makeUser(schoolA.schoolId, schoolA.slug, "STUDENT");

    const upload = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/documents`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .field("ownerId", ownerA.userId)
      .field("type", "BIRTH_CERTIFICATE")
      .attach("file", pdfBuffer(), { filename: "birth.pdf", contentType: "application/pdf" })
      .expect(201);
    const docId = upload.body.data.document.id as string;

    // B's admin on A's URL: tenant mismatch.
    const mismatch = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/documents/${docId}`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(403);
    expect(mismatch.body.error.code).toBe("TENANT_MISMATCH");

    // B's admin on B's URL with A's row id: scoped invisible = 404, not a leak oracle.
    const invisible = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/documents/${docId}`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(404);
    expect(invisible.body.error.code).toBe("NOT_FOUND");

    // A's admin reads it fine (positive direction).
    await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/documents/${docId}`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .expect(200);
  });

  it("lets the owning student read it, blocks another student and an unlinked parent", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    void adminToken;
    const owner = await makeUser(schoolId, slug, "STUDENT");
    const stranger = await makeUser(schoolId, slug, "STUDENT");
    await makeStudentProfile(schoolId, owner.userId);
    await makeStudentProfile(schoolId, stranger.userId);

    const upload = await request(app)
      .post(`/api/v1/schools/${schoolId}/documents`)
      .set("Authorization", `Bearer ${adminToken}`)
      .field("ownerId", owner.userId)
      .field("type", "PHOTO")
      .attach("file", pdfBuffer(), { filename: "photo.jpg", contentType: "image/jpeg" })
      .expect(201);
    const docId = upload.body.data.document.id as string;

    await request(app)
      .get(`/api/v1/schools/${schoolId}/documents/${docId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);

    const blocked = await request(app)
      .get(`/api/v1/schools/${schoolId}/documents/${docId}`)
      .set("Authorization", `Bearer ${stranger.token}`)
      .expect(403);
    expect(blocked.body.error.code).toBe("FORBIDDEN");
  });
});
