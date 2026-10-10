import { readdirSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { setMailer, stubMailer, type AbsenteeAlert } from "../src/lib/mailer.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

const sent: AbsenteeAlert[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  setMailer({
    ...stubMailer,
    sendAbsenteeAlert: async (alert: AbsenteeAlert) => {
      sent.push(alert);
      return "sent";
    },
  });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockClear();
});

afterAll(() => {
  setMailer(null);
  logSpy.mockRestore();
});

async function registerSchool(name: string): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: name,
      adminName: "Mail Demo Admin",
      adminEmail: `mail-demo-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function absentPupil(schoolId: string): Promise<{ sectionId: string; studentId: string; guardianEmail: string }> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
  const parentRole = await prisma.role.findUniqueOrThrow({ where: { name: "PARENT" } });
  const studentUser = await prisma.user.create({
    data: { schoolId, roleId: studentRole.id, email: `mail-demo-student-${uid()}@example.com`, passwordHash: "x", name: "Mail Demo Student" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: studentUser.id, sectionId: section.id } });
  const guardianEmail = `mail-demo-guardian-${uid()}@example.com`;
  const parent = await prisma.user.create({
    data: { schoolId, roleId: parentRole.id, email: guardianEmail, passwordHash: "x", name: "Mail Demo Parent" },
  });
  await prisma.studentGuardian.create({
    data: { schoolId, studentId: student.id, parentId: parent.id, relationship: "Mother" },
  });
  return { sectionId: section.id, studentId: student.id, guardianEmail };
}

async function markAbsent(schoolId: string, adminToken: string, sectionId: string, studentId: string): Promise<void> {
  await request(app)
    .post(`/api/v1/schools/${schoolId}/attendance`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ sectionId, date: "2026-10-12", records: [{ studentId, status: "ABSENT" }] })
    .expect(200);
}

function demoLogFor(slug: string): boolean {
  return logSpy.mock.calls.some((args: unknown[]) =>
    args.some(
      (a: unknown) => typeof a === "string" && a.includes("[demo]") && a.includes("absentee-alert") && a.includes(slug),
    ),
  );
}

describe("demo mail suppression (§13.11, both directions)", () => {
  it("LOGS instead of sending a demo school's absentee alert", async () => {
    const school = await registerSchool(`Mail Demo School ${uid()}`);
    await prisma.school.update({ where: { id: school.schoolId }, data: { isDemo: true } });
    const pupil = await absentPupil(school.schoolId);
    sent.length = 0;

    await markAbsent(school.schoolId, school.adminToken, pupil.sectionId, pupil.studentId);

    // Nothing reached the sender — and the suppression itself is VISIBLE in
    // the log (a silent drop would be untestable and undebuggable).
    expect(sent).toHaveLength(0);
    expect(demoLogFor(school.slug)).toBe(true);
  });

  it("SENDS a normal school's absentee alert with no suppression log", async () => {
    const school = await registerSchool(`Mail Real School ${uid()}`);
    const pupil = await absentPupil(school.schoolId);
    sent.length = 0;

    await markAbsent(school.schoolId, school.adminToken, pupil.sectionId, pupil.studentId);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(pupil.guardianEmail);
    expect(demoLogFor(school.slug)).toBe(false);
  });
});

describe("single send function (structural)", () => {
  it("routes every src send through mailerFor() — no bare mailer() call remains", () => {
    // Same guard shape as the audit append-only scan: the choke point is
    // structural (SmtpMailer is module-private, no-school mailer() is
    // deleted), and this test makes a future bypass fail loudly.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith(".ts")) {
          continue;
        }
        const code = readFileSync(full, "utf8").replace(/\/\/.*$/gm, "");
        const matches = code.match(/[^A-Za-z]mailer\(\s*\)/g);
        if (matches) {
          offenders.push(full);
        }
      }
    };
    walk(join(dirname(fileURLToPath(import.meta.url)), "..", "src"));
    expect(offenders).toEqual([]);
  });
});
