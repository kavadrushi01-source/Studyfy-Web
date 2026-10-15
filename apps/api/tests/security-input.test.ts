import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { razorpayKeys } from "../src/lib/razorpay.js";
import { setDocumentStorage } from "../src/lib/storage.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

const savedRazorId = process.env.RAZORPAY_KEY_ID;
const savedRazorSecret = process.env.RAZORPAY_KEY_SECRET;

function clearRazorEnv(): void {
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
}

afterAll(() => {
  if (savedRazorId === undefined) {
    delete process.env.RAZORPAY_KEY_ID;
  } else {
    process.env.RAZORPAY_KEY_ID = savedRazorId;
  }
  if (savedRazorSecret === undefined) {
    delete process.env.RAZORPAY_KEY_SECRET;
  } else {
    process.env.RAZORPAY_KEY_SECRET = savedRazorSecret;
  }
  setDocumentStorage(null);
});

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string; adminEmail: string; adminId: string }> {
  const adminEmail = `secin-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Secin Admin", adminEmail, adminPassword: "password-123" })
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

describe("JWT attacks (§13.3)", () => {
  it("rejects forged, expiry-tampered and algorithm-swapped tokens; honors a valid one", async () => {
    const school = await registerSchool(`Secin JWT School ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const secret = process.env.JWT_ACCESS_SECRET ?? "";
    expect(secret.length).toBeGreaterThan(0);

    // Control: the real token works.
    await request(app).get(`/api/v1/schools/${school.schoolId}/notices`).set(auth).expect(200);

    // Wrong-signature forgery (attacker re-signs a payload with their own key).
    const forged = jwt.sign(
      { sub: school.adminId, schoolId: school.schoolId, role: "SCHOOL_ADMIN", type: "access" },
      "attacker-controlled-secret",
      { expiresIn: "15m" },
    );
    await request(app)
      .get(`/api/v1/schools/${school.schoolId}/notices`)
      .set({ Authorization: `Bearer ${forged}` })
      .expect(401);

    // Expired token dies, even with a valid signature.
    const expired = jwt.sign(
      { sub: school.adminId, schoolId: school.schoolId, role: "SCHOOL_ADMIN", type: "access" },
      secret,
      { expiresIn: "-10s" },
    );
    await request(app)
      .get(`/api/v1/schools/${school.schoolId}/notices`)
      .set({ Authorization: `Bearer ${expired}` })
      .expect(401);

    // Algorithm confusion: header says none/RS256 but the server only
    // honors HS256 with its own secret.
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const noneToken = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: school.adminId, schoolId: school.schoolId, role: "SCHOOL_ADMIN", type: "access" })}.`;
    await request(app)
      .get(`/api/v1/schools/${school.schoolId}/notices`)
      .set({ Authorization: `Bearer ${noneToken}` })
      .expect(401);
  });
});

describe("mass assignment (§9.1, §13.3)", () => {
  it("ignores role/school/plan/status smuggling on register and admit", async () => {
    const adminEmail = `secin-mass-${uid()}@example.com`;
    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        schoolName: `Mass School ${uid()}`,
        adminName: "Mass Admin",
        adminEmail,
        adminPassword: "password-123",
        role: "PLATFORM_OWNER",
        school_id: "somewhere-else",
        schoolId: "somewhere-else",
        plan: "PREMIUM",
        status: "ACTIVE",
        isDemo: true,
      })
      .expect(201);
    const schoolId = reg.body.data.school.id as string;
    const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: adminEmail } } });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { id: admin.roleId } });
    // Still a plain admin of their own fresh school — nothing escalated,
    // nothing borrowed.
    expect(adminRole.name).toBe("SCHOOL_ADMIN");
    expect(admin.schoolId).toBe(schoolId);
    const school = await prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    expect(school.isDemo).toBe(false);
    expect(school.subscriptionStatus).toBe("TRIAL");

    // Pupil admission with role/isActive smuggling stays a pupil.
    const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
    const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
    const pupilEmail = `mass-pupil-${uid()}@example.com`;
    await request(app)
      .post(`/api/v1/schools/${schoolId}/students`)
      .set({ Authorization: `Bearer ${reg.body.data.accessToken as string}` })
      .send({
        name: "Mass Pupil",
        email: pupilEmail,
        sectionId: section.id,
        role: "SCHOOL_ADMIN",
        isActive: false,
        schoolId: "elsewhere",
      })
      .expect(201);
    const pupil = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: pupilEmail } } });
    const pupilRole = await prisma.role.findUniqueOrThrow({ where: { id: pupil.roleId } });
    expect(pupilRole.name).toBe("STUDENT");
    expect(pupil.isActive).toBe(true);
    expect(pupil.schoolId).toBe(schoolId);
  });
});

describe("sort/pagination edges (§8.5, §9.2)", () => {
  it("rejects injection and out-of-range paging with 400, never 500", async () => {
    const school = await registerSchool(`Secin Page School ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const base = `/api/v1/schools/${school.schoolId}/students`;
    for (const q of ["?sort=passwordHash", "?sort=__proto__", "?sort=constructor", "?order=up", "?page=0", "?page=-2", "?pageSize=0", "?pageSize=501", "?pageSize=-5"]) {
      const res = await request(app).get(`${base}${q}`).set(auth);
      expect(res.status).toBe(400);
    }
    // Sane values still work.
    await request(app).get(`${base}?sort=name&order=desc&page=1&pageSize=5`).set(auth).expect(200);
  });
});

describe("hostile strings stored verbatim, never executed (§13.1)", () => {
  it("keeps CRLF/unicode/SQLi as data on enquiry + ticket, with no header reflection", async () => {
    const school = await registerSchool(`Secin Xss School ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const evilName = "Robert\u2019s School\r\nX-Injected: yes";
    const evilMsg = `Hello <script>alert(1)</script> 👋'; DROP TABLE students;-- ${"x".repeat(50)}`;
    const eq = await request(app).post("/api/v1/public/enquiries").send({
      name: evilName.slice(0, 120),
      email: `evil-${uid()}@example.com`,
      message: evilMsg.slice(0, 2000),
      schoolSlug: school.slug,
    });
    expect(eq.status).toBe(201);
    expect(eq.headers["x-injected"]).toBeUndefined();
    const stored = await prisma.enquiry.findFirstOrThrow({ where: { schoolId: school.schoolId }, orderBy: { createdAt: "desc" } });
    expect(stored.name).toBe(evilName.slice(0, 120));

    const subject = `Subj <img src=x onerror=alert(1)> ${uid()}`;
    const tk = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets`)
      .set(auth)
      .send({ subject, priority: "LOW" });
    expect(tk.status).toBe(201);
    expect(tk.headers["x-injected"]).toBeUndefined();
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: tk.body.data.id as string } });
    expect(ticket.subject).toBe(subject);
  });

  it("rejects MIME spoofing both directions and neutralizes path traversal names", async () => {
    setDocumentStorage({
      upload: async (input) => ({
        url: `https://cdn.example/${input.schoolId}/fake-${uid()}.png`,
        publicId: `fake-${uid()}`,
      }),
    });
    const school = await registerSchool(`Secin Mime School ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const ticket = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets`)
      .set(auth)
      .send({ subject: `Mime ${uid()}`, priority: "LOW" })
      .expect(201);
    const ticketId = ticket.body.data.id as string;
    const url = `/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}/attachments`;

    // .png bytes claimed as text, and .txt claimed as image: both 415.
    const spoof1 = await request(app).post(url).set(auth).attach("file", Buffer.alloc(64, 7), {
      filename: "shot.png",
      contentType: "text/plain",
    });
    expect(spoof1.status).toBe(415);
    const spoof2 = await request(app).post(url).set(auth).attach("file", Buffer.from("hello"), {
      filename: "note.txt",
      contentType: "image/png",
    });
    expect(spoof2.status).toBe(415);

    // Path traversal in the filename: accepted as inert metadata (the
    // stored object lives under a random public ID, never this name).
    const evil: { status: number; body: { data: { id: string } } } = (await request(app)
      .post(url)
      .set(auth)
      .field("message", "Traversal.")
      .attach("file", Buffer.alloc(64, 7), {
        filename: "../../etc/passwd.png",
        contentType: "image/png",
      })) as unknown as { status: number; body: { data: { id: string } } };
    expect(evil.status).toBe(201);
    const row = await prisma.ticketAttachment.findFirstOrThrow({ where: { schoolId: school.schoolId } });
    expect(row.messageId).toBe(evil.body.data.id);
  });
});

describe("Razorpay key guards (§13.8, §1 test-mode boundary)", () => {
  it("refuses live keys loudly and unconfigured keys cleanly, honors test keys", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_accident";
    process.env.RAZORPAY_KEY_SECRET = "shh";
    let err: unknown = null;
    try {
      razorpayKeys();
    } catch (e) {
      err = e;
    }
    expect((err as { code?: string } | null)?.code).toBe("PAYMENTS_MISCONFIGURED");

    clearRazorEnv();
    err = null;
    try {
      razorpayKeys();
    } catch (e) {
      err = e;
    }
    expect((err as { code?: string } | null)?.code).toBe("PAYMENTS_UNCONFIGURED");

    process.env.RAZORPAY_KEY_ID = "rzp_test_ok123";
    process.env.RAZORPAY_KEY_SECRET = "shh-test";
    expect(razorpayKeys()).toMatchObject({ keyId: "rzp_test_ok123" });
  });
});
