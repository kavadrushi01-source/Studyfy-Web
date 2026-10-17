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

const STORED_PDF = Buffer.from("%PDF-1.4 stored-artifact-bytes");
const STORED_URL = `data:application/pdf;base64,${STORED_PDF.toString("base64")}`;

beforeAll(() => {
  // Every issue in this file stores through the stub: the download must
  // then serve THESE bytes (proving stored-serving, not regeneration).
  setDocumentStorage({
    upload: async () => ({ url: STORED_URL, publicId: `fake-${uid()}` }),
  });
});

afterAll(() => {
  setDocumentStorage(null);
});

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Cert School ${uid()}`,
      adminName: "Cert Admin",
      adminEmail: `cert-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makePupil(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
  const user = await prisma.user.create({
    data: {
      schoolId,
      roleId: role.id,
      email: `cert-pupil-${uid()}@example.com`,
      passwordHash: await bcrypt.hash("pupil-pass-123", 4),
      name: "Cert Pupil",
    },
  });
  const student = await prisma.student.create({
    data: { schoolId, userId: user.id, sectionId: section.id, admissionNo: `ADM-${uid()}` },
  });
  return student.id;
}

describe("Certificates (§7 Phase 2 #17)", () => {
  it("issues with sequential serials, lists, and downloads identical PDFs", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const studentId = await makePupil(schoolId);

    const first = await request(app)
      .post(`/api/v1/schools/${schoolId}/certificates`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ studentId, type: "BONAFIDE" })
      .expect(201);
    expect(first.body.data.certificate.serial).toMatch(/^CERT\/\d{4}\/0001$/);
    expect(first.body.data.certificate.student.name).toBe("Cert Pupil");

    const second = await request(app)
      .post(`/api/v1/schools/${schoolId}/certificates`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ studentId, type: "TRANSFER" })
      .expect(201);
    expect(second.body.data.certificate.serial).toMatch(/^CERT\/\d{4}\/0002$/);

    const list = await request(app)
      .get(`/api/v1/schools/${schoolId}/certificates`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.data.total).toBe(2);

    const pdfA = await request(app)
      .get(`/api/v1/schools/${schoolId}/certificates/${first.body.data.certificate.id as string}/pdf`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(pdfA.headers["content-type"]).toContain("application/pdf");
    expect((pdfA.body as Buffer).slice(0, 5).toString()).toBe("%PDF-");

    // Re-download serves the STORED artifact bytes (not a regeneration):
    // byte-identical to what the stub "uploaded".
    const pdfB = await request(app)
      .get(`/api/v1/schools/${schoolId}/certificates/${first.body.data.certificate.id as string}/pdf`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(Buffer.compare(pdfB.body as Buffer, STORED_PDF)).toBe(0);

    // And the issue left a documents row (type CERTIFICATE, owned by the
    // pupil) behind the certificate record.
    const doc = await prisma.document.findFirst({
      where: { schoolId, type: "CERTIFICATE" },
      select: { url: true, ownerId: true },
    });
    expect(doc?.url).toBe(STORED_URL);
    const pupilUser = await prisma.student.findFirstOrThrow({ where: { id: studentId }, select: { userId: true } });
    expect(doc?.ownerId).toBe(pupilUser.userId);

    // Detail backs the print page: record + frozen snapshot.
    const detail = await request(app)
      .get(`/api/v1/schools/${schoolId}/certificates/${first.body.data.certificate.id as string}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.data.certificate.serial).toMatch(/^CERT\/\d{4}\/0001$/);
    expect(detail.body.data.certificate.payload.studentName).toBe("Cert Pupil");
  });

  it("refuses a certificate upload once a demo school hits the stored-file cap", async () => {
    const { schoolId, adminToken } = await registerSchool();
    await prisma.school.update({ where: { id: schoolId }, data: { isDemo: true } });
    const studentId = await makePupil(schoolId);
    const pupil = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true } });
    await prisma.document.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        schoolId,
        ownerId: pupil.userId,
        url: `https://cdn.example/cap-${i}.pdf`,
        type: "OTHER",
      })),
    });

    const res = await request(app)
      .post(`/api/v1/schools/${schoolId}/certificates`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ studentId, type: "BONAFIDE" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("DEMO_UPLOAD_CAP");
  });

  it("issues distinct serials for concurrent requests instead of 500ing the loser", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const studentId = await makePupil(schoolId);
    const auth = { Authorization: `Bearer ${adminToken}` };
    const body = { studentId, type: "BONAFIDE" };

    const [first, second] = await Promise.all([
      request(app).post(`/api/v1/schools/${schoolId}/certificates`).set(auth).send(body),
      request(app).post(`/api/v1/schools/${schoolId}/certificates`).set(auth).send(body),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const serials = [first.body.data.certificate.serial, second.body.data.certificate.serial].sort();
    expect(serials[0]).not.toBe(serials[1]);
    expect(await prisma.certificate.count({ where: { schoolId } })).toBe(2);
  });

  it("refuses strangers, bad types, and keyless roles", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const studentId = await makePupil(schoolA.schoolId);

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/certificates`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ studentId, type: "GOLD_MEDAL" })
      .expect(400);

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/certificates`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ studentId: "cmu00000000000000000000000", type: "BONAFIDE" })
      .expect(404);

    // Foreign pupil id through our URL: tenant scope turns it into a 404.
    const foreignPupil = await makePupil(schoolB.schoolId);
    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/certificates`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ studentId: foreignPupil, type: "BONAFIDE" })
      .expect(404);

    // Stranger school's admin sees nothing of ours.
    const cross = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/certificates`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(200);
    expect(cross.body.data.total).toBe(0);

    // Teachers and pupils hold no certificates key at all.
    const teacherRole = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
    const teacherEmail = `cert-teacher-${uid()}@example.com`;
    const teacherUser = await prisma.user.create({
      data: { schoolId: schoolA.schoolId, roleId: teacherRole.id, email: teacherEmail, passwordHash: await bcrypt.hash("t-pass-123", 4), name: "Cert Teacher" },
    });
    await prisma.staff.create({
      data: { schoolId: schoolA.schoolId, userId: teacherUser.id, designation: "Teacher" },
    });
    const teacherLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: teacherEmail, password: "t-pass-123", schoolSlug: schoolA.slug })
      .expect(200);
    const denied = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/certificates`)
      .set("Authorization", `Bearer ${teacherLogin.body.data.accessToken as string}`)
      .expect(403);
    expect(denied.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("falls back to snapshot regeneration when storage is unconfigured (local dev)", async () => {
    setDocumentStorage(null);
    try {
      const { schoolId, adminToken } = await registerSchool();
      const studentId = await makePupil(schoolId);
      const issued = await request(app)
        .post(`/api/v1/schools/${schoolId}/certificates`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ studentId, type: "CHARACTER" })
        .expect(201);
      const pdf = await request(app)
        .get(`/api/v1/schools/${schoolId}/certificates/${issued.body.data.certificate.id as string}/pdf`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect((pdf.body as Buffer).slice(0, 5).toString()).toBe("%PDF-");
    } finally {
      setDocumentStorage({ upload: async () => ({ url: STORED_URL, publicId: `fake-${uid()}` }) });
    }
  });
});
