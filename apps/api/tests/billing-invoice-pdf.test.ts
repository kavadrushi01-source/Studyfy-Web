import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { generateSubscriptionInvoice } from "../src/lib/invoice-pdf.js";
import { issueInvoice } from "../src/modules/billing/billing.service.js";
import { startOfDayUtc } from "../src/modules/billing/billing.service.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

// PDFKit deflates content streams AND splits rendered text into hex chunks
// with kerning adjustments, so visible words never appear literally in the
// raw bytes (same helper shape as the report-card PDF test).
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const inflated: string[] = [];
  let from = 0;
  for (;;) {
    const start = raw.indexOf("stream", from);
    if (start === -1) {
      break;
    }
    const end = raw.indexOf("endstream", start);
    if (end === -1) {
      break;
    }
    let chunk = raw.slice(start + "stream".length, end);
    chunk = chunk.replace(/^\r\n/, "").replace(/^\n/, "").replace(/\r\n$/, "").replace(/\n$/, "");
    try {
      inflated.push(inflateSync(Buffer.from(chunk, "latin1")).toString("latin1"));
    } catch {
      inflated.push(chunk);
    }
    from = end + "endstream".length;
  }
  const content = inflated.join("\n");
  const words: string[] = [];
  const hexRe = /<([0-9a-fA-F]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(content)) !== null) {
    const hex = m[1] ?? "";
    if (hex.length >= 2 && hex.length % 2 === 0) {
      words.push(Buffer.from(hex, "hex").toString("latin1"));
    }
  }
  return words.join("");
}

const INVOICE = {
  schoolName: "Invoice PDF School",
  brandColor: "#2563EB",
  invoiceNumber: "STY/26-27/0042",
  financialYear: "2026-27",
  plan: "STANDARD",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  amountPaise: 599900,
  cgstPaise: 53991,
  sgstPaise: 53991,
  igstPaise: 0,
  status: "PENDING",
  paidMethod: null,
  paidAt: null,
};

describe("subscription invoice PDF (§16.1, pure)", () => {
  it("renders a stamped PDF with the number, totals, and no GSTIN", async () => {
    const pdf = await generateSubscriptionInvoice(INVOICE);
    expect(pdf.slice(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1024);
    const text = pdfText(pdf);
    expect(text).toContain("STY/26-27/0042");
    expect(text).toContain("TEST INVOICE");
    expect(text).toContain("7078.82");
    expect(text).not.toMatch(/gstin/i);
  });
});

describe("subscription invoice PDF route (§16.1)", () => {
  async function registerSchool(name: string): Promise<{ schoolId: string; adminToken: string; adminId: string }> {
    const adminEmail = `invoice-pdf-admin-${uid()}@example.com`;
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ schoolName: name, adminName: "Invoice PDF Admin", adminEmail, adminPassword: "password-123" })
      .expect(201);
    const schoolId = res.body.data.school.id as string;
    const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: adminEmail } } });
    return { schoolId, adminToken: res.body.data.accessToken as string, adminId: admin.id };
  }

  async function issueFor(schoolId: string, adminId: string, month: number): Promise<string> {
    const issued = await issueInvoice(
      prisma,
      schoolId,
      {
        plan: "STANDARD",
        periodStart: startOfDayUtc(new Date(`2026-${month}-01T00:00:00Z`)),
        periodEnd: startOfDayUtc(new Date(`2026-${month}-28T00:00:00Z`)),
        schoolState: "Gujarat",
        platformState: "Gujarat",
      },
      adminId,
    );
    return issued.id;
  }

  async function makeTeacherToken(schoolId: string, slug: string): Promise<string> {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
    const email = `invoice-pdf-teacher-${uid()}@example.com`;
    const user = await prisma.user.create({
      data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash("teacher-pass-123", 4), name: "Invoice Teacher" },
    });
    await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ schoolSlug: slug, email, password: "teacher-pass-123" })
      .expect(200);
    return login.body.data.accessToken as string;
  }

  it("serves the stamped PDF to the admin; everyone else is refused", async () => {
    const school = await registerSchool(`Invoice PDF School ${uid()}`);
    const slug = (await prisma.school.findUniqueOrThrow({ where: { id: school.schoolId } })).slug;
    const invoiceId = await issueFor(school.schoolId, school.adminId, 11);

    const pdf = await request(app)
      .get(`/api/v1/schools/${school.schoolId}/billing/invoices/${invoiceId}/pdf`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain(".pdf");
    const bytes = pdf.body as Buffer;
    expect(bytes.slice(0, 5).toString()).toBe("%PDF-");
    const text = pdfText(bytes);
    expect(text).toContain("TEST INVOICE");
    expect(text).not.toMatch(/gstin/i);

    // Teacher: billing.read is admin-only.
    await request(app)
      .get(`/api/v1/schools/${school.schoolId}/billing/invoices/${invoiceId}/pdf`)
      .set("Authorization", `Bearer ${await makeTeacherToken(school.schoolId, slug)}`)
      .expect(403);
    // No token.
    await request(app).get(`/api/v1/schools/${school.schoolId}/billing/invoices/${invoiceId}/pdf`).expect(401);
    // Unknown invoice.
    await request(app)
      .get(`/api/v1/schools/${school.schoolId}/billing/invoices/nope/pdf`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .expect(404);
  });

  it("refuses cross-tenant invoice ids, but serves a suspended admin (billing path)", async () => {
    const a = await registerSchool(`Invoice PDF A ${uid()}`);
    const b = await registerSchool(`Invoice PDF B ${uid()}`);
    const bInvoice = await issueFor(b.schoolId, b.adminId, 11);
    // B's invoice id on A's route: scoped lookup finds nothing.
    await request(app)
      .get(`/api/v1/schools/${a.schoolId}/billing/invoices/${bInvoice}/pdf`)
      .set("Authorization", `Bearer ${a.adminToken}`)
      .expect(404);

    const aInvoice = await issueFor(a.schoolId, a.adminId, 12);
    await prisma.school.update({ where: { id: a.schoolId }, data: { subscriptionStatus: "SUSPENDED" } });
    // Suspended admin keeps billing-path access (§13.4 exception covers
    // every /billing/ route, overview and PDF alike).
    await request(app)
      .get(`/api/v1/schools/${a.schoolId}/billing/invoices/${aInvoice}/pdf`)
      .set("Authorization", `Bearer ${a.adminToken}`)
      .expect(200);
  });
});
