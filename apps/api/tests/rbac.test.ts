import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Request, Response } from "express";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { requirePermission } from "../src/middleware/rbac.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function runPermission(
  role: string | undefined,
  key: string,
): Promise<{ status: number; code: string; passed: boolean }> {
  let status = 0;
  let code = "";
  let passed = false;
  const req = {
    user: role === undefined ? undefined : { userId: "u", schoolId: "s", role },
  } as unknown as Request;
  const res = {
    status(s: number) {
      status = s;
      return this;
    },
    json(b: { error: { code: string } }) {
      code = b.error.code;
      return this;
    },
  } as unknown as Response;
  requirePermission(key)(req, res, () => {
    passed = true;
  });
  const deadline = Date.now() + 5000;
  while (!passed && !code && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return { status, code, passed };
}

describe("RBAC permission tables (RULES.md §6)", () => {
  it("denies a role with no mapping, then allows it once the table grants it", async () => {
    // A throwaway role touching ONLY its own rows — no shared mapping is
    // ever mutated, so parallel test files cannot flake.
    const roleName = `TEMP_RBAC_${uid()}`;
    const email = `temp-rbac-${uid()}@example.com`;
    const password = "temp-pass-123";

    const reg = await request(app)
      .post("/api/v1/auth/register")
      .send({
        schoolName: `RBAC School ${uid()}`,
        adminName: "RBAC Admin",
        adminEmail: `rbac-admin-${uid()}@example.com`,
        adminPassword: "password-123",
      })
      .expect(201);
    const schoolId = reg.body.data.school.id as string;
    const slug = reg.body.data.school.slug as string;

    const role = await prisma.role.create({ data: { name: roleName, description: "RBAC test role" } });
    await prisma.user.create({
      data: {
        schoolId,
        roleId: role.id,
        email,
        passwordHash: await bcrypt.hash(password, 4),
        name: "Temp RBAC User",
      },
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password, schoolSlug: slug })
      .expect(200);
    const token = login.body.data.accessToken as string;

    try {
      const denied = await request(app)
        .get(`/api/v1/schools/${schoolId}/students`)
        .set("Authorization", `Bearer ${token}`)
        .expect(403);
      expect(denied.body.error.code).toBe("PERMISSION_DENIED");

      const permission = await prisma.permission.findUnique({ where: { key: "students.read" } });
      expect(permission).not.toBeNull();
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission?.id ?? "" } });

      await request(app)
        .get(`/api/v1/schools/${schoolId}/students`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
    } finally {
      const tempUser = await prisma.user.findUnique({ where: { schoolId_email: { schoolId, email } } });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (tempUser) {
        // Login mints a refresh-token row — delete it before the user (FK).
        await prisma.refreshToken.deleteMany({ where: { userId: tempUser.id } });
        await prisma.user.delete({ where: { id: tempUser.id } });
      }
      await prisma.role.delete({ where: { id: role.id } });
    }
  });

  it("fails closed on unknown roles and unknown keys, passes on a real grant", async () => {
    const ghost = await runPermission("GHOST_ROLE", "students.read");
    expect(ghost.passed).toBe(false);
    expect(ghost.status).toBe(403);
    expect(ghost.code).toBe("PERMISSION_DENIED");

    const typo = await runPermission("STUDENT", "students.typo");
    expect(typo.passed).toBe(false);
    expect(typo.status).toBe(403);
    expect(typo.code).toBe("PERMISSION_DENIED");

    const granted = await runPermission("STUDENT", "students.read");
    expect(granted.passed).toBe(true);

    const owner = await runPermission("PLATFORM_OWNER", "platform.schools.read");
    expect(owner.passed).toBe(true);
  });

  it("rejects unauthenticated callers with 401, not 403", async () => {
    const result = await runPermission(undefined, "students.read");
    expect(result.passed).toBe(false);
    expect(result.status).toBe(401);
  });
});
