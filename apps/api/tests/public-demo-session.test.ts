import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();
const DEMO_SCHOOL_SLUG = "school-of-science";

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function ensureDemoSchool(): Promise<string> {
  let school = await prisma.school.findUnique({ where: { slug: DEMO_SCHOOL_SLUG } });
  if (!school) {
    const registered = await request(app)
      .post("/api/v1/auth/register")
      .send({
        schoolName: "Public Demo Test School",
        slug: DEMO_SCHOOL_SLUG,
        adminName: "Public Demo Admin",
        adminEmail: `public-demo-${uid()}@example.com`,
        adminPassword: "test-password-123",
      })
      .expect(201);
    school = await prisma.school.findUniqueOrThrow({ where: { id: registered.body.data.school.id as string } });
  }
  if (!school.isDemo) {
    school = await prisma.school.update({ where: { id: school.id }, data: { isDemo: true } });
  }

  const demoAdmin = await prisma.user.findFirst({
    where: { schoolId: school.id, isActive: true, role: { name: "SCHOOL_ADMIN" } },
    select: { id: true },
  });
  if (!demoAdmin) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "SCHOOL_ADMIN" } });
    await prisma.user.create({
      data: {
        schoolId: school.id,
        roleId: role.id,
        email: `public-demo-admin-${uid()}@example.com`,
        passwordHash: "unused-public-demo-password",
        name: "Public Demo Admin",
      },
    });
  }
  return school.id;
}

describe("POST /api/v1/auth/demo-session", () => {
  it("mints a short-lived read-only demo token without a refresh cookie", async () => {
    const schoolId = await ensureDemoSchool();
    const response = await request(app).post("/api/v1/auth/demo-session").expect(200);
    const { accessToken, expiresAt, schoolSlug, user } = response.body.data as {
      accessToken: string;
      expiresAt: string;
      schoolSlug: string;
      user: { id: string; role: string; schoolId: string };
    };

    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(schoolSlug).toBe(DEMO_SCHOOL_SLUG);
    expect(user.role).toBe("SCHOOL_ADMIN");
    expect(user.schoolId).toBe(schoolId);
    const ttlMs = Date.parse(expiresAt) - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60 * 1000);

    const decoded = jwt.verify(accessToken, process.env.JWT_ACCESS_SECRET ?? "") as Record<string, unknown>;
    expect(decoded.sub).toBe(user.id);
    expect(decoded.schoolId).toBe(schoolId);
    expect(decoded.role).toBe("SCHOOL_ADMIN");
    expect(decoded.readOnly).toBe(true);

    const auth = { Authorization: `Bearer ${accessToken}` };
    await request(app).get(`/api/v1/schools/${schoolId}/students`).set(auth).expect(200);

    const write = await request(app)
      .post(`/api/v1/schools/${schoolId}/students`)
      .set(auth)
      .send({});
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe("READ_ONLY_SESSION");

    await request(app).post("/api/v1/auth/refresh").send({ accessToken }).expect(401);
  });
});
