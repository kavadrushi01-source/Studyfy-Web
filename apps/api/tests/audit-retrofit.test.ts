import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { schoolDay } from "../src/lib/school-time.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string; adminId: string; adminEmail: string }> {
  const adminEmail = `retrofit-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Retrofit Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId: res.body.data.school.id as string, email: adminEmail } } });
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
    adminId: admin.id,
    adminEmail,
  };
}

async function makeSection(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  return section.id;
}

async function auditRows(schoolId: string, action: string) {
  return prisma.auditLog.findMany({ where: { schoolId, action }, orderBy: { createdAt: "asc" } });
}

describe("audit retrofit: USER_CREATE (§13.10)", () => {
  it(
    "admission writes one row per fresh user (student + guardian), hashes never logged",
    { timeout: 30000 },
    async () => {
      const school = await registerSchool(`Retrofit Admit School ${uid()}`);
      const sectionId = await makeSection(school.schoolId);
      const email = `retrofit-pupil-${uid()}@example.com`;
      const guardianEmail = `retrofit-guardian-${uid()}@example.com`;

      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/students`)
        .set("Authorization", `Bearer ${school.adminToken}`)
        .send({
          name: "Retrofit Pupil",
          email,
          sectionId,
          admissionNo: `ADM-${uid()}`,
          guardians: [{ name: "Retrofit Guardian", email: guardianEmail, relationship: "Father" }],
        })
        .expect(201);

      const rows = await auditRows(school.schoolId, "USER_CREATE");
      expect(rows).toHaveLength(2);
      const byEntity = new Map(rows.map((r) => [r.entityId, r]));
      expect(byEntity.get(email)?.after).toMatchObject({ role: "STUDENT", isActive: true });
      expect(byEntity.get(guardianEmail)?.after).toMatchObject({ role: "PARENT", isActive: true });
      for (const row of rows) {
        expect(row.actorId).toBe(school.adminId);
        expect(row.entity).toBe("User");
        expect(JSON.stringify(row.after)).not.toContain("passwordHash");
        expect(JSON.stringify(row.before ?? {})).not.toContain("passwordHash");
      }
    },
  );

  it(
    "staff invite writes one row with the invited role",
    { timeout: 30000 },
    async () => {
      const school = await registerSchool(`Retrofit Invite School ${uid()}`);
      const email = `retrofit-teacher-${uid()}@example.com`;

      await request(app)
        .post(`/api/v1/schools/${school.schoolId}/staff`)
        .set("Authorization", `Bearer ${school.adminToken}`)
        .send({ name: "Retrofit Teacher", email, role: "TEACHER" })
        .expect(201);

      const rows = await auditRows(school.schoolId, "USER_CREATE");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entityId).toBe(email);
      expect(rows[0]?.actorId).toBe(school.adminId);
      expect(rows[0]?.after).toMatchObject({ role: "TEACHER", isActive: true });
    },
  );
});

describe("audit retrofit: MARK_CREATE / MARK_UPDATE (§13.10)", () => {
  it("logs creates without before and updates with before/after scores", async () => {
    const school = await registerSchool(`Retrofit Marks School ${uid()}`);
    const sectionId = await makeSection(school.schoolId);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
    const user = await prisma.user.create({
      data: { schoolId: school.schoolId, roleId: role.id, email: `marks-${uid()}@example.com`, passwordHash: "x", name: "Marks Pupil" },
    });
    const student = await prisma.student.create({ data: { schoolId: school.schoolId, userId: user.id, sectionId } });
    const math = await prisma.subject.create({ data: { schoolId: school.schoolId, name: `Mathematics ${uid()}`, group: "Core" } });
    const examRes = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/exams`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ name: "Unit Test 1", subjects: [{ subjectId: math.id, maxMarks: 50 }] })
      .expect(201);
    const examId = examRes.body.data.exam.id as string;
    const examSubjectId = (examRes.body.data.exam.examSubjects[0] as { id: string }).id;
    const url = `/api/v1/schools/${school.schoolId}/exams/${examId}/marks`;
    const body = { examSubjectId, sectionId, records: [{ studentId: student.id, marksObtained: 42 }] };

    await request(app).post(url).set("Authorization", `Bearer ${school.adminToken}`).send(body).expect(200);
    let rows = await auditRows(school.schoolId, "MARK_CREATE");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity).toBe("Mark");
    expect(rows[0]?.entityId).toBe(student.id);
    expect(rows[0]?.actorId).toBe(school.adminId);
    expect(rows[0]?.before).toBeNull();
    expect(rows[0]?.after).toMatchObject({ studentId: student.id, examSubjectId, score: 42 });

    await request(app)
      .post(url)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ examSubjectId, sectionId, records: [{ studentId: student.id, marksObtained: 45 }] })
      .expect(200);
    rows = await auditRows(school.schoolId, "MARK_UPDATE");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.before).toMatchObject({ score: 42 });
    expect(rows[0]?.after).toMatchObject({ score: 45 });
  });
});

describe("audit retrofit: ATTENDANCE_EDIT (§13.10)", () => {
  it("skips routine first marks, logs overwrites and past-day marks", async () => {
    const school = await registerSchool(`Retrofit Attendance School ${uid()}`);
    const sectionId = await makeSection(school.schoolId);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
    const user = await prisma.user.create({
      data: { schoolId: school.schoolId, roleId: role.id, email: `att-${uid()}@example.com`, passwordHash: "x", name: "Att Pupil" },
    });
    const student = await prisma.student.create({ data: { schoolId: school.schoolId, userId: user.id, sectionId } });
    const url = `/api/v1/schools/${school.schoolId}/attendance`;
    const auth = { Authorization: `Bearer ${school.adminToken}` };

    // Routine same-day first mark: no audit row (noise, not an edit).
    // Today's date is derived, never hardcoded — a fixed string would rot
    // into a "past day" the morning after it was written.
    const todayStr = schoolDay("Asia/Kolkata", new Date());
    await request(app).post(url).set(auth).send({ sectionId, date: todayStr, records: [{ studentId: student.id, status: "PRESENT" }] }).expect(200);
    expect(await auditRows(school.schoolId, "ATTENDANCE_EDIT")).toHaveLength(0);

    // Same-day overwrite: before/after.
    await request(app).post(url).set(auth).send({ sectionId, date: todayStr, records: [{ studentId: student.id, status: "ABSENT" }] }).expect(200);
    let rows = await auditRows(school.schoolId, "ATTENDANCE_EDIT");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.before).toMatchObject({ studentId: student.id, date: todayStr, status: "PRESENT" });
    expect(rows[0]?.after).toMatchObject({ studentId: student.id, date: todayStr, status: "ABSENT" });
    expect(rows[0]?.actorId).toBe(school.adminId);

    // Past-day first mark ("after the fact"): logged, with no before.
    await request(app).post(url).set(auth).send({ sectionId, date: "2026-01-05", records: [{ studentId: student.id, status: "PRESENT" }] }).expect(200);
    rows = await auditRows(school.schoolId, "ATTENDANCE_EDIT");
    expect(rows).toHaveLength(2);
    expect(rows[1]?.before).toBeNull();
    expect(rows[1]?.after).toMatchObject({ date: "2026-01-05", status: "PRESENT" });
  });
});

describe("audit retrofit: fees (§13.10)", () => {
  it("logs structure create, bulk-generate summary, and manual payment with both rows", async () => {
    const school = await registerSchool(`Retrofit Fees School ${uid()}`);
    const cls = await prisma.class.create({ data: { schoolId: school.schoolId, name: `Class ${uid()}` } });
    const section = await prisma.section.create({ data: { schoolId: school.schoolId, classId: cls.id, name: "A" } });
    const auth = { Authorization: `Bearer ${school.adminToken}` };

    const structRes = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/fees/structures`)
      .set(auth)
      .send({ classId: cls.id, name: "Term 1 Tuition", amount: "8000.00", term: "Term 1", category: "TUITION" })
      .expect(201);
    const structureId = structRes.body.data.structure.id as string;
    let rows = await auditRows(school.schoolId, "FEE_STRUCTURE_CREATE");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entityId).toBe(structureId);
    expect(rows[0]?.after).toMatchObject({ classId: cls.id, name: "Term 1 Tuition", amount: "8000.00", term: "Term 1" });

    const role = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
    const user = await prisma.user.create({
      data: { schoolId: school.schoolId, roleId: role.id, email: `fees-${uid()}@example.com`, passwordHash: "x", name: "Fees Pupil" },
    });
    const student = await prisma.student.create({ data: { schoolId: school.schoolId, userId: user.id, sectionId: section.id } });

    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/fees/invoices/generate`)
      .set(auth)
      .send({ structureId, sectionId: section.id, dueDate: "2026-12-31" })
      .expect(201);
    rows = await auditRows(school.schoolId, "INVOICES_GENERATED");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.after).toMatchObject({ structureId, count: 1 });

    const invoice = await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId: school.schoolId, studentId: student.id } });
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/fees/invoices/${invoice.id}/pay`)
      .set(auth)
      .send({ amount: "1000", method: "CASH" })
      .expect(200);
    const payRows = await auditRows(school.schoolId, "PAYMENT_RECORDED");
    expect(payRows).toHaveLength(2);
    const paymentRow = payRows.find((r) => r.entity === "FeePayment");
    const invoiceRow = payRows.find((r) => r.entity === "FeeInvoice");
    expect(paymentRow?.after).toMatchObject({ invoiceId: invoice.id, amount: "1000.00", method: "CASH", status: "CAPTURED" });
    expect(paymentRow?.actorId).toBe(school.adminId);
    expect(invoiceRow?.entityId).toBe(invoice.id);
    expect(invoiceRow?.before).toMatchObject({ status: "PENDING", amountPaid: "0.00" });
    expect(invoiceRow?.after).toMatchObject({ status: "PARTIAL", amountPaid: "1000.00" });
  });

  it("logs a webhook capture with a NULL machine actor, exactly once on redelivery", async () => {
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = "wh-audit-secret";
    try {
      const school = await registerSchool(`Retrofit Webhook School ${uid()}`);
      const cls = await prisma.class.create({ data: { schoolId: school.schoolId, name: `Class ${uid()}` } });
      const section = await prisma.section.create({ data: { schoolId: school.schoolId, classId: cls.id, name: "A" } });
      const structure = await prisma.feeStructure.create({
        data: { schoolId: school.schoolId, classId: cls.id, name: `Struct ${uid()}`, amount: "15000.00", term: "Term 1", category: "TUITION" },
      });
      const role = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
      const user = await prisma.user.create({
        data: { schoolId: school.schoolId, roleId: role.id, email: `hook-${uid()}@example.com`, passwordHash: "x", name: "Hook Pupil" },
      });
      const student = await prisma.student.create({ data: { schoolId: school.schoolId, userId: user.id, sectionId: section.id } });
      const invoice = await prisma.feeInvoice.create({
        data: { schoolId: school.schoolId, studentId: student.id, structureId: structure.id, amount: "15000.00", dueDate: new Date("2026-11-15T00:00:00Z") },
      });
      const orderId = `order_AUDIT_${uid()}`;
      const paymentId = `pay_AUDIT_${uid()}`;
      await prisma.feePayment.create({
        data: { schoolId: school.schoolId, invoiceId: invoice.id, amount: "15000.00", method: "RAZORPAY", razorpayOrderId: orderId, status: "PENDING" },
      });
      const body = {
        event: "payment.captured",
        payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: 1500000, currency: "INR", status: "captured" } } },
      };
      const signature = createHmac("sha256", "wh-audit-secret").update(JSON.stringify(body)).digest("hex");

      const fire = () =>
        request(app).post("/api/v1/payments/webhook").set("x-razorpay-signature", signature).send(body).expect(200);
      const first = await fire();
      expect(first.body.data.alreadyProcessed).toBe(false);
      await fire(); // redelivery: no second log row for the same capture

      const rows = await auditRows(school.schoolId, "PAYMENT_CAPTURED");
      expect(rows.filter((r) => r.entity === "FeePayment")).toHaveLength(1);
      expect(rows.filter((r) => r.entity === "FeeInvoice")).toHaveLength(1);
      for (const row of rows) {
        expect(row.actorId).toBeNull();
      }
      expect(rows.find((r) => r.entity === "FeePayment")?.after).toMatchObject({ invoiceId: invoice.id, method: "RAZORPAY", status: "CAPTURED" });
    } finally {
      if (saved === undefined) {
        delete process.env.RAZORPAY_WEBHOOK_SECRET;
      } else {
        process.env.RAZORPAY_WEBHOOK_SECRET = saved;
      }
    }
  });
});

describe("audit retrofit: CERTIFICATE_ISSUED (§13.10)", () => {
  it("logs the issued certificate with serial and pupil", async () => {
    const school = await registerSchool(`Retrofit Cert School ${uid()}`);
    const sectionId = await makeSectionLike(school.schoolId);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
    const user = await prisma.user.create({
      data: { schoolId: school.schoolId, roleId: role.id, email: `cert-${uid()}@example.com`, passwordHash: "x", name: "Cert Pupil" },
    });
    const student = await prisma.student.create({ data: { schoolId: school.schoolId, userId: user.id, sectionId } });

    const res = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/certificates`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ studentId: student.id, type: "BONAFIDE" })
      .expect(201);
    const certId = res.body.data.certificate.id as string;
    const serial = res.body.data.certificate.serial as string;

    const rows = await auditRows(school.schoolId, "CERTIFICATE_ISSUED");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity).toBe("Certificate");
    expect(rows[0]?.entityId).toBe(certId);
    expect(rows[0]?.actorId).toBe(school.adminId);
    expect(rows[0]?.after).toMatchObject({ studentId: student.id, type: "BONAFIDE", serial });
  });
});

async function makeSectionLike(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  return section.id;
}
