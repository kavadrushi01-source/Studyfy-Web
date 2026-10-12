import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { parseCsv } from "../src/modules/students/students-csv.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

const HEADER = "StudentName,StudentEmail,Section,AdmissionNo,GuardianName,GuardianEmail,GuardianRelationship";

function csv(lines: string[]): Buffer {
  return Buffer.from([HEADER, ...lines].join("\n"), "utf8");
}

function row(
  student: string,
  email: string,
  section: string,
  admissionNo: string,
  guardian: string,
  gEmail: string,
  rel = "Father",
): string {
  return `${student},${email},${section},${admissionNo},${guardian},${gEmail},${rel}`;
}

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: name,
      adminName: "CSV Admin",
      adminEmail: `csv-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSection(schoolId: string, className = "Grade 9", sectionName = "A"): Promise<void> {
  const cls = await prisma.class.create({ data: { schoolId, name: `${className} ${uid()}` } });
  await prisma.section.create({ data: { schoolId, classId: cls.id, name: sectionName } });
}

async function sectionLabel(schoolId: string): Promise<string> {
  const section = await prisma.section.findFirstOrThrow({ where: { schoolId }, include: { class: true } });
  return `${section.class.name}-${section.name}`;
}

async function setPlan(schoolId: string, plan: "BASIC" | "STANDARD" | "PREMIUM"): Promise<void> {
  await prisma.school.update({ where: { id: schoolId }, data: { plan, subscriptionStatus: "ACTIVE" } });
}

async function makeTeacher(schoolId: string): Promise<string> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
  const email = `csv-teacher-${uid()}@example.com`;
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash("teacher-pass-123", 4), name: "CSV Teacher" },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ schoolSlug: (await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })).slug, email, password: "teacher-pass-123" })
    .expect(200);
  return login.body.data.accessToken as string;
}

function postCsv(schoolId: string, token: string | null, file: Buffer, filename = "students.csv", mime = "text/csv") {
  const req = request(app).post(`/api/v1/schools/${schoolId}/students/import`);
  if (token) {
    req.set("Authorization", `Bearer ${token}`);
  }
  return req.attach("file", file, { filename, contentType: mime });
}

describe("CSV parser (pure, §7 Phase 0)", () => {
  it("reads quoted commas, escaped quotes, CRLF, and skips blank lines", () => {
    const table = parseCsv(Buffer.from('a,b,c\r\n"Doe, Jane",j@e.com,"Grade 9-A"\r\n"Say ""hi""",k@e.com,B\r\n\r\n', "utf8"));
    expect(table).toEqual([
      ["a", "b", "c"],
      ["Doe, Jane", "j@e.com", "Grade 9-A"],
      ['Say "hi"', "k@e.com", "B"],
    ]);
  });

  it("rejects unterminated quotes and NUL bytes", () => {
    expect(() => parseCsv(Buffer.from('"abc,def\n', "utf8"))).toThrow();
    expect(() => parseCsv(Buffer.from("a\0b,c\n", "utf8"))).toThrow();
  });
});

describe("student CSV import (§7 Phase 0, §16.1)", () => {
  it("imports valid rows with a per-row report, temp passwords, and audit", async () => {
    const school = await registerSchool(`CSV School ${uid()}`);
    await makeSection(school.schoolId);
    const section = await sectionLabel(school.schoolId);
    const tag = uid();
    const res = await postCsv(
      school.schoolId,
      school.adminToken,
      csv([
        row("Asha Rao", `asha-${tag}@example.com`, section, `ADM-${tag}-1`, "Ravi Rao", `ravi-${tag}@example.com`),
        row("Dev Patel", `dev-${tag}@example.com`, section, `ADM-${tag}-2`, "Meena Patel", `meena-${tag}@example.com`, "Mother"),
      ]),
    ).expect(200);
    expect(res.body.data.summary).toEqual({ total: 2, imported: 2, refused: 0 });
    expect(res.body.data.refused).toEqual([]);
    const [first, second] = res.body.data.imported as { row: number; studentTempPassword: string; guardians: { tempPassword: string | null }[] }[];
    expect(first?.row).toBe(1);
    expect(second?.row).toBe(2);
    expect(first?.studentTempPassword.length).toBeGreaterThan(0);
    expect(first?.guardians[0]?.tempPassword?.length).toBeGreaterThan(0);
    expect(await prisma.student.count({ where: { schoolId: school.schoolId } })).toBe(2);
    // One USER_CREATE per fresh account: 2 pupils + 2 guardians.
    expect(await prisma.auditLog.count({ where: { schoolId: school.schoolId, action: "USER_CREATE" } })).toBe(4);
  });

  it("refuses bad rows with exact row numbers and codes — nothing silent", async () => {
    const school = await registerSchool(`CSV Refuse School ${uid()}`);
    await makeSection(school.schoolId);
    const section = await sectionLabel(school.schoolId);
    const tag = uid();
    const res = await postCsv(
      school.schoolId,
      school.adminToken,
      csv([
        row("Good Pupil", `good-${tag}@example.com`, section, "", "Good Guardian", `gg-${tag}@example.com`),
        row("Bad Email", "not-an-email", section, "", "Guardian", `g2-${tag}@example.com`),
        row("Lost Pupil", `lost-${tag}@example.com`, "Grade 9-Z", "", "Guardian", `g3-${tag}@example.com`),
        row("Copy Pupil", `good-${tag}@example.com`, section, "", "Guardian", `g4-${tag}@example.com`),
        row("No Guardian", `nog-${tag}@example.com`, section, "", "Guardian", "also-bad"),
      ]),
    ).expect(200);
    expect(res.body.data.summary).toEqual({ total: 5, imported: 1, refused: 4 });
    expect(res.body.data.imported.map((r: { row: number }) => r.row)).toEqual([1]);
    const refused = res.body.data.refused as { row: number; code: string }[];
    expect(refused.map((r) => [r.row, r.code])).toEqual([
      [2, "VALIDATION_ERROR"],
      [3, "SECTION_NOT_FOUND"],
      [4, "DUPLICATE_ROW"],
      [5, "VALIDATION_ERROR"],
    ]);
    expect(await prisma.student.count({ where: { schoolId: school.schoolId } })).toBe(1);
  });

  it("refuses already-registered emails without double-creating", async () => {
    const school = await registerSchool(`CSV Taken School ${uid()}`);
    await makeSection(school.schoolId);
    const section = await sectionLabel(school.schoolId);
    const tag = uid();
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/students`)
      .set("Authorization", `Bearer ${school.adminToken}`)
      .send({ name: "First", email: `taken-${tag}@example.com`, sectionId: (await prisma.section.findFirstOrThrow({ where: { schoolId: school.schoolId } })).id })
      .expect(201);
    const res = await postCsv(
      school.schoolId,
      school.adminToken,
      csv([row("Second", `taken-${tag}@example.com`, section, "", "Guardian", `g-${tag}@example.com`)]),
    ).expect(200);
    expect(res.body.data.summary).toEqual({ total: 1, imported: 0, refused: 1 });
    expect(res.body.data.refused[0].code).toBe("EMAIL_TAKEN");
    expect(await prisma.student.count({ where: { schoolId: school.schoolId } })).toBe(1);
  });

  it("enforces the cap per row within one file (first fills, rest refuse)", async () => {
    const school = await registerSchool(`CSV Cap School ${uid()}`);
    await setPlan(school.schoolId, "BASIC");
    await makeSection(school.schoolId);
    const section = await sectionLabel(school.schoolId);
    const studentRole = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
    // 499 pupils, two cheap statements — bcrypt per row proves nothing here.
    const tag = uid();
    const userRows = Array.from({ length: 499 }, (_, i) => ({
      id: randomUUID(),
      schoolId: school.schoolId,
      roleId: studentRole.id,
      email: `csvcap-${tag}-${i}@example.com`,
      passwordHash: "x",
      name: `Cap Pupil ${i}`,
    }));
    await prisma.user.createMany({ data: userRows });
    const sectionId = (await prisma.section.findFirstOrThrow({ where: { schoolId: school.schoolId } })).id;
    await prisma.student.createMany({
      data: userRows.map((u) => ({ schoolId: school.schoolId, userId: u.id, sectionId })),
    });
    const res = await postCsv(
      school.schoolId,
      school.adminToken,
      csv([
        row("Five Hundred", `fiveh-${tag}@example.com`, section, "", "Guardian", `g1-${tag}@example.com`),
        row("Five Oh One", `fiveo-${tag}@example.com`, section, "", "Guardian", `g2-${tag}@example.com`),
      ]),
    ).expect(200);
    expect(res.body.data.summary).toEqual({ total: 2, imported: 1, refused: 1 });
    expect(res.body.data.imported[0].row).toBe(1);
    expect(res.body.data.refused[0]).toMatchObject({ row: 2, code: "PLAN_UPGRADE_REQUIRED" });
    expect(await prisma.student.count({ where: { schoolId: school.schoolId } })).toBe(500);
  });

  it("rejects cross-tenant tokens, teachers, strangers, and suspended schools", async () => {
    const a = await registerSchool(`CSV Tenant A ${uid()}`);
    const b = await registerSchool(`CSV Tenant B ${uid()}`);
    await makeSection(a.schoolId);
    const section = await sectionLabel(a.schoolId);
    const tag = uid();
    const file = csv([row("Pupil", `p-${tag}@example.com`, section, "", "Guardian", `g-${tag}@example.com`)]);
    // Stranger-school token on A's route: tenant mismatch.
    await postCsv(a.schoolId, b.adminToken, file).expect(403);
    // Teacher: lacks students.write.
    await postCsv(a.schoolId, await makeTeacher(a.schoolId), file).expect(403);
    // No token at all.
    await postCsv(a.schoolId, null, file).expect(401);
    // Suspended school: the gate blocks import (not a billing path).
    await prisma.school.update({ where: { id: a.schoolId }, data: { subscriptionStatus: "SUSPENDED" } });
    const blocked = await postCsv(a.schoolId, a.adminToken, file);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("SCHOOL_SUSPENDED");
  });

  it("rejects bad files loudly: missing, wrong type, too big, empty, bad header, too many rows", async () => {
    const school = await registerSchool(`CSV Files School ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    // No file.
    const missing = await request(app).post(`/api/v1/schools/${school.schoolId}/students/import`).set(auth);
    expect(missing.status).toBe(400);
    // Wrong type (extension and MIME must agree on .csv).
    const txt = await postCsv(school.schoolId, school.adminToken, Buffer.from("a,b\n", "utf8"), "students.txt", "text/plain");
    expect(txt.status).toBe(415);
    // Too big (> 2 MB).
    const big = await postCsv(
      school.schoolId,
      school.adminToken,
      Buffer.alloc(2 * 1024 * 1024 + 1, "a"),
      "big.csv",
      "text/csv",
    );
    expect(big.status).toBe(413);
    // Header only.
    const empty = await postCsv(school.schoolId, school.adminToken, Buffer.from(`${HEADER}\n`, "utf8"));
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("EMPTY_FILE");
    // Wrong header.
    const header = await postCsv(school.schoolId, school.adminToken, Buffer.from("Name,Email\nA,a@e.com\n", "utf8"));
    expect(header.status).toBe(400);
    // Too many rows (501 data rows — refused before any DB work).
    const many = [`X,x-${uid()}@example.com,Grade 9-A,,G,g-${uid()}@example.com,Father`];
    for (let i = 0; i < 500; i += 1) {
      many.push(`P${i},p${i}-${uid()}@example.com,Grade 9-A,,G,g${i}-${uid()}@example.com,Father`);
    }
    const overflow = await postCsv(school.schoolId, school.adminToken, csv(many));
    expect(overflow.status).toBe(400);
    expect(overflow.body.error.code).toBe("TOO_MANY_ROWS");
  });
});
