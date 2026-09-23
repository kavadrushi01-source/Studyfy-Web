import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Accountant Board School ${uid()}`,
      adminName: "Accountant Board Admin",
      adminEmail: `accountant-board-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function loginAs(schoolId: string, slug: string, roleName: string): Promise<string> {
  const email = `board-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "board-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `Board ${roleName}` },
  });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

async function admit(schoolId: string, adminToken: string, sectionId: string): Promise<void> {
  await request(app)
    .post(`/api/v1/schools/${schoolId}/students`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      name: "Board Pupil",
      email: `board-pupil-${uid()}@example.com`,
      sectionId,
      admissionNo: `ACC-${uid()}`,
      gender: "Female",
      guardians: [{ name: "Board Guardian", email: `board-guard-${uid()}@example.com`, relationship: "Mother" }],
    })
    .expect(201);
}

interface AccountantBundle {
  totalCollected: string;
  pendingFees: string;
  overdueFees: string;
  totalStudents: number;
  trend: { month: string; collected: string }[];
  byStatus: { status: string; count: number; amount: string }[];
  recentTransactions: { id: string; studentName: string; amount: string; method: string; invoiceStatus: string }[];
  asOf: { day: string; month: string };
}

describe("GET /api/v1/schools/:schoolId/dashboard/accountant (§8.3)", () => {
  it(
    "returns collected/pending/overdue sums, trend, donut, and transactions",
    async () => {
      const { schoolId, slug, adminToken } = await registerSchool();
      const accountantToken = await loginAs(schoolId, slug, "ACCOUNTANT");
      const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
      const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
      await admit(schoolId, adminToken, section.id);
      await admit(schoolId, adminToken, section.id);

      const structure = await request(app)
        .post(`/api/v1/schools/${schoolId}/fees/structures`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ classId: cls.id, name: `Board Term ${uid()}`, amount: "10000.00", term: "Term 1", category: "TUITION" })
        .expect(201);
      await request(app)
        .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ structureId: structure.body.data.structure.id as string, classId: cls.id, dueDate: "2026-12-31" })
        .expect(201);

      const invoices = await prisma.feeInvoice.findMany({ where: { schoolId }, orderBy: { createdAt: "asc" } });
      expect(invoices).toHaveLength(2);
      // Partial payment on the first; second goes overdue (directly — first
      // dashboard read happens after, so nothing cached needs invalidating).
      await request(app)
        .post(`/api/v1/schools/${schoolId}/fees/invoices/${invoices[0]!.id}/pay`)
        .set("Authorization", `Bearer ${accountantToken}`)
        .send({ amount: "2500", method: "CASH" })
        .expect(200);
      await prisma.feeInvoice.update({ where: { id: invoices[1]!.id }, data: { status: "OVERDUE" } });

      const res = await request(app)
        .get(`/api/v1/schools/${schoolId}/dashboard/accountant`)
        .set("Authorization", `Bearer ${accountantToken}`)
        .expect(200);
      const board = res.body.data.dashboard as AccountantBundle;
      expect(board.totalStudents).toBe(2);
      expect(board.totalCollected).toBe("2500.00");
      expect(board.pendingFees).toBe("7500.00");
      expect(board.overdueFees).toBe("10000.00");
      expect(board.trend).toHaveLength(6);
      const current = board.trend[board.trend.length - 1]!;
      expect(current.month).toBe(board.asOf.month);
      expect(current.collected).toBe("2500.00");
      expect(board.byStatus).toMatchObject([
        { status: "OVERDUE", count: 1 },
        { status: "PARTIAL", count: 1 },
      ]);
      expect(board.recentTransactions).toHaveLength(1);
      expect(board.recentTransactions[0]).toMatchObject({ amount: "2500.00", method: "CASH", invoiceStatus: "PARTIAL" });
      expect(typeof board.recentTransactions[0]?.studentName).toBe("string");
    },
    30000,
  );

  it(
    "reflects payments through the route (write invalidates the board)",
    async () => {
      const { schoolId, slug, adminToken } = await registerSchool();
      const accountantToken = await loginAs(schoolId, slug, "ACCOUNTANT");
      const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
      const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
      await admit(schoolId, adminToken, section.id);

      const structure = await request(app)
        .post(`/api/v1/schools/${schoolId}/fees/structures`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ classId: cls.id, name: `Board Term ${uid()}`, amount: "5000.00", term: "Term 1", category: "TUITION" })
        .expect(201);
      await request(app)
        .post(`/api/v1/schools/${schoolId}/fees/invoices/generate`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ structureId: structure.body.data.structure.id as string, classId: cls.id, dueDate: "2026-12-31" })
        .expect(201);
      const invoice = await prisma.feeInvoice.findFirstOrThrow({ where: { schoolId } });

      const before = await request(app)
        .get(`/api/v1/schools/${schoolId}/dashboard/accountant`)
        .set("Authorization", `Bearer ${accountantToken}`)
        .expect(200);
      expect((before.body.data.dashboard as AccountantBundle).totalCollected).toBe("0.00");

      await request(app)
        .post(`/api/v1/schools/${schoolId}/fees/invoices/${invoice.id}/pay`)
        .set("Authorization", `Bearer ${accountantToken}`)
        .send({ amount: "5000", method: "UPI" })
        .expect(200);

      const after = await request(app)
        .get(`/api/v1/schools/${schoolId}/dashboard/accountant`)
        .set("Authorization", `Bearer ${accountantToken}`)
        .expect(200);
      const board = after.body.data.dashboard as AccountantBundle;
      expect(board.totalCollected).toBe("5000.00");
      expect(board.pendingFees).toBe("0.00");
      expect(board.byStatus).toMatchObject([{ status: "PAID", count: 1 }]);
    },
    30000,
  );

  it(
    "is accountant-only: admin, teachers, students, cross-tenant all denied",
    async () => {
      const schoolA = await registerSchool();
      const schoolB = await registerSchool();
      const accountantB = await loginAs(schoolB.schoolId, schoolB.slug, "ACCOUNTANT");
      const teacherA = await loginAs(schoolA.schoolId, schoolA.slug, "TEACHER");
      const pupilA = await loginAs(schoolA.schoolId, schoolA.slug, "STUDENT");

      for (const token of [schoolA.adminToken, teacherA]) {
        const denied = await request(app)
          .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/accountant`)
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
        expect(denied.body.error.code).toBe("FORBIDDEN");
      }
      const pupilDenied = await request(app)
        .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/accountant`)
        .set("Authorization", `Bearer ${pupilA}`)
        .expect(403);
      expect(pupilDenied.body.error.code).toBe("FORBIDDEN");

      const cross = await request(app)
        .get(`/api/v1/schools/${schoolA.schoolId}/dashboard/accountant`)
        .set("Authorization", `Bearer ${accountantB}`)
        .expect(403);
      expect(cross.body.error.code).toBe("TENANT_MISMATCH");

      await request(app).get(`/api/v1/schools/${schoolA.schoolId}/dashboard/accountant`).expect(401);
    },
    30000,
  );
});
