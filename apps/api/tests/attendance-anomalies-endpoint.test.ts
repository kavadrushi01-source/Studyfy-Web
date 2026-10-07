import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { setGroqClient, stubGroqClient } from "../src/lib/groq.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

const savedKey = process.env.GROQ_API_KEY;

afterEach(() => {
  setGroqClient(null);
  if (savedKey === undefined) {
    delete process.env.GROQ_API_KEY;
  } else {
    process.env.GROQ_API_KEY = savedKey;
  }
});

async function registerSchool(): Promise<{ schoolId: string; slug: string; adminToken: string }> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({
      schoolName: `Anomaly School ${uid()}`,
      adminName: "Anomaly Admin",
      adminEmail: `anomaly-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeSection(schoolId: string): Promise<string> {
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: `S${uid()}` } });
  return section.id;
}

async function loginAs(
  schoolId: string,
  slug: string,
  role: string,
  tag: string,
): Promise<{ userId: string; token: string }> {
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  if (!roleRow) {
    throw new Error(`${role} role must be seeded`);
  }
  const email = `anomaly-${tag}-${uid()}@example.com`;
  const user = await prisma.user.create({
    data: { schoolId, roleId: roleRow.id, email, passwordHash: await bcrypt.hash("password-123", 4), name: `${tag} user` },
  });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: "password-123", schoolSlug: slug })
    .expect(200);
  return { userId: user.id, token: login.body.data.accessToken as string };
}

async function makeClassTeacher(schoolId: string, slug: string, sectionId: string): Promise<string> {
  const { userId, token } = await loginAs(schoolId, slug, "TEACHER", "classteacher");
  const staff = await prisma.staff.create({ data: { schoolId, userId, designation: "Teacher" } });
  await prisma.section.update({ where: { id: sectionId }, data: { classTeacherId: staff.id } });
  return token;
}

async function makePupil(schoolId: string, sectionId: string, name: string): Promise<string> {
  const role = await prisma.role.findUnique({ where: { name: "STUDENT" } });
  if (!role) {
    throw new Error("STUDENT role must be seeded");
  }
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email: `anomaly-pupil-${uid()}@example.com`, passwordHash: "x", name },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId } });
  return student.id;
}

// Ten marked days 2026-09-01..10; statuses given per day, oldest first
// (single-letter shorthands mapped to the Prisma enum here).
const TRAIL_STATUS: Record<string, "PRESENT" | "ABSENT" | "LATE" | "EXCUSED"> = {
  P: "PRESENT",
  A: "ABSENT",
  L: "LATE",
  E: "EXCUSED",
};

async function markTrail(schoolId: string, sectionId: string, studentId: string, statuses: string[]): Promise<void> {
  for (let i = 0; i < statuses.length; i += 1) {
    const code = statuses[i] ?? "P";
    const status = TRAIL_STATUS[code];
    if (!status) {
      throw new Error(`Unknown trail code ${code}`);
    }
    await prisma.attendance.create({
      data: {
        schoolId,
        studentId,
        sectionId,
        date: new Date(`2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
        status,
      },
    });
  }
}

describe("GET attendance/anomalies (§7 Phase 3 #18 — detect locally, Groq phrases)", () => {
  it("flags the truant, clears the regular, and returns the stubbed summary without pupil names", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const truant = await makePupil(schoolId, sectionId, "Truant Tara");
    const regular = await makePupil(schoolId, sectionId, "Regular Ravi");
    await markTrail(schoolId, sectionId, truant, ["P", "P", "P", "P", "P", "P", "P", "A", "A", "A"]);
    await markTrail(schoolId, sectionId, regular, ["P", "P", "P", "P", "P", "P", "P", "P", "P", "P"]);

    const stub = stubGroqClient("Two pupils show concern: one with three straight absences.");
    setGroqClient(stub);

    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/anomalies?sectionId=${sectionId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const data = res.body.data as {
      checked: number;
      flagged: { studentId: string; name: string; anomalies: { type: string; facts: string }[] }[];
      summary: string;
      summaryStatus: string;
    };
    expect(data.checked).toBe(2);
    expect(data.flagged).toHaveLength(1);
    expect(data.flagged[0]?.studentId).toBe(truant);
    expect(data.flagged[0]?.anomalies.map((a) => a.type)).toContain("CONSECUTIVE_ABSENCES");
    expect(data.summary).toBe("Two pupils show concern: one with three straight absences.");
    expect(data.summaryStatus).toBe("ok");

    // The summary prompt carries facts, never pupil names.
    expect(stub.calls).toHaveLength(1);
    const prompt = stub.calls[0]?.prompt ?? "";
    expect(prompt).not.toContain("Truant Tara");
    expect(prompt).not.toContain("Regular Ravi");
    expect(prompt).toContain("3 consecutive absences");
  });

  it("class teacher sees own section; outsiders, pupils, and stranger admins are refused", async () => {
    const { schoolId, slug } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const otherSectionId = await makeSection(schoolId);
    const pupil = await makePupil(schoolId, sectionId, "Wandering Wren");
    await markTrail(schoolId, sectionId, pupil, ["P", "P", "P", "P", "P", "P", "P", "A", "A", "A"]);
    const teacherToken = await makeClassTeacher(schoolId, slug, sectionId);
    const outsiderToken = await makeClassTeacher(schoolId, slug, otherSectionId);
    const { token: pupilToken } = await loginAs(schoolId, slug, "STUDENT", "pupil");
    setGroqClient(stubGroqClient("Summary."));

    const url = `/api/v1/schools/${schoolId}/attendance/anomalies?sectionId=${sectionId}`;
    await request(app).get(url).set("Authorization", `Bearer ${teacherToken}`).expect(200);
    const outsider = await request(app).get(url).set("Authorization", `Bearer ${outsiderToken}`);
    expect(outsider.status).toBe(403);
    // Pupils hold attendance.read but are not staff: same roster-style gate.
    await request(app).get(url).set("Authorization", `Bearer ${pupilToken}`).expect(403);

    const other = await registerSchool();
    await request(app)
      .get(url)
      .set("Authorization", `Bearer ${other.adminToken}`)
      .expect(403);
  });

  it("returns detections with a null summary when Groq is unconfigured (AI enhances, not gates)", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const pupil = await makePupil(schoolId, sectionId, "Unsummary Uma");
    await markTrail(schoolId, sectionId, pupil, ["P", "P", "P", "P", "P", "P", "P", "A", "A", "A"]);
    delete process.env.GROQ_API_KEY;
    setGroqClient(null);

    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/anomalies?sectionId=${sectionId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.data.flagged).toHaveLength(1);
    expect(res.body.data.summary).toBeNull();
    expect(res.body.data.summaryStatus).toBe("unconfigured");
  });

  it("400s bad queries and 404s unknown sections", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    const auth = { Authorization: `Bearer ${adminToken}` };
    const base = `/api/v1/schools/${schoolId}/attendance/anomalies`;

    await request(app).get(base).set(auth).expect(400);
    await request(app).get(`${base}?sectionId=${sectionId}&windowDays=2`).set(auth).expect(400);
    await request(app).get(`${base}?sectionId=${sectionId}&windowDays=99`).set(auth).expect(400);
    const missing = await request(app).get(`${base}?sectionId=no-such-section`).set(auth);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("SECTION_NOT_FOUND");
  });

  it("reports an empty scan honestly (no rows, no flags, no summary call)", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const sectionId = await makeSection(schoolId);
    await makePupil(schoolId, sectionId, "Unmarked Usha");
    const stub = stubGroqClient("Must not be called.");
    setGroqClient(stub);

    const res = await request(app)
      .get(`/api/v1/schools/${schoolId}/attendance/anomalies?sectionId=${sectionId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.data.checked).toBe(1);
    expect(res.body.data.flagged).toEqual([]);
    expect(res.body.data.summary).toBeNull();
    expect(stub.calls).toHaveLength(0);
  });
});
