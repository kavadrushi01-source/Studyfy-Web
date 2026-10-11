import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
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
      schoolName: `Inventory School ${uid()}`,
      adminName: "Inventory Admin",
      adminEmail: `inventory-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  // Phase 3 module under test (§16.1): this fixture school buys Premium.
  // Plan-gating itself is proven in billing-gating.test.ts.
  const schoolId = res.body.data.school.id as string;
  await prisma.school.update({ where: { id: schoolId }, data: { plan: "PREMIUM", subscriptionStatus: "ACTIVE" } });
  return {
    schoolId,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function loginAs(schoolId: string, slug: string, role: string, tag: string): Promise<string> {
  const roleRow = await prisma.role.findUnique({ where: { name: role } });
  if (!roleRow) {
    throw new Error(`${role} role must be seeded`);
  }
  const email = `inventory-${tag}-${uid()}@example.com`;
  await prisma.user.create({
    data: { schoolId, roleId: roleRow.id, email, passwordHash: await bcrypt.hash("password-123", 4), name: `${tag} user` },
  });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: "password-123", schoolSlug: slug })
    .expect(200);
  return login.body.data.accessToken as string;
}

describe("inventory (§7 Phase 3 #22 — movement-only stock)", () => {
  it("full circuit: add, stock in, stock out, over-draw refused, history explains the counter", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const auth = { Authorization: `Bearer ${adminToken}` };
    const base = `/api/v1/schools/${schoolId}/inventory/items`;

    const created = await request(app)
      .post(base)
      .set(auth)
      .send({ name: "Chalk Box", category: "Stationery", unit: "box", reorderLevel: 5 })
      .expect(201);
    const itemId = created.body.data.item.id as string;
    expect(created.body.data.item).toMatchObject({ quantity: 0, lowStock: true });

    await request(app)
      .post(`${base}/${itemId}/movements`)
      .set(auth)
      .send({ type: "IN", quantity: 20, reason: "Term purchase" })
      .expect(201);
    const out = await request(app)
      .post(`${base}/${itemId}/movements`)
      .set(auth)
      .send({ type: "OUT", quantity: 6, reason: "Class 9-A" })
      .expect(201);
    expect(out.body.data.item).toMatchObject({ quantity: 14, lowStock: false });

    const over = await request(app)
      .post(`${base}/${itemId}/movements`)
      .set(auth)
      .send({ type: "OUT", quantity: 15 });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("INSUFFICIENT_STOCK");

    const history = await request(app).get(`${base}/${itemId}/movements`).set(auth).expect(200);
    expect(history.body.data.item).toMatchObject({ quantity: 14 });
    expect(history.body.data.movements).toHaveLength(2);
    expect(history.body.data.movements[0]).toMatchObject({ type: "OUT", quantity: 6 });

    // Duplicate names collide per school.
    const dup = await request(app).post(base).set(auth).send({ name: "Chalk Box" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ITEM_EXISTS");
  });

  it("low-stock filter, search, rename, and validation", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const auth = { Authorization: `Bearer ${adminToken}` };
    const base = `/api/v1/schools/${schoolId}/inventory/items`;

    const a = await request(app).post(base).set(auth).send({ name: "Lab Beaker", reorderLevel: 10 }).expect(201);
    await request(app).post(base).set(auth).send({ name: "Football", category: "Sports" }).expect(201);
    const aId = a.body.data.item.id as string;
    await request(app).post(`${base}/${aId}/movements`).set(auth).send({ type: "IN", quantity: 3 }).expect(201);

    const low = await request(app).get(`${base}?lowStock=true`).set(auth).expect(200);
    const lowNames = (low.body.data.items as { name: string }[]).map((i) => i.name);
    expect(lowNames).toContain("Lab Beaker");
    expect(lowNames).toContain("Football");

    const searched = await request(app).get(`${base}?search=beak`).set(auth).expect(200);
    expect((searched.body.data.items as { name: string }[]).map((i) => i.name)).toEqual(["Lab Beaker"]);

    const renamed = await request(app).patch(`${base}/${aId}`).set(auth).send({ name: "Lab Beaker 500ml" }).expect(200);
    expect(renamed.body.data.item.name).toBe("Lab Beaker 500ml");

    await request(app).post(base).set(auth).send({}).expect(400);
    await request(app).post(`${base}/${aId}/movements`).set(auth).send({ type: "ADJUST", quantity: 1 }).expect(400);
    await request(app).patch(`${base}/${aId}`).set(auth).send({}).expect(400);
  });

  it("gates: teachers read, pupils see nothing, strangers see nothing", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const other = await registerSchool();
    const teacherToken = await loginAs(schoolId, slug, "TEACHER", "teacher");
    const pupilToken = await loginAs(schoolId, slug, "STUDENT", "pupil");
    const base = `/api/v1/schools/${schoolId}/inventory/items`;

    await request(app).get(base).set("Authorization", `Bearer ${teacherToken}`).expect(200);
    await request(app).get(base).set("Authorization", `Bearer ${pupilToken}`).expect(403);
    await request(app)
      .post(base)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ name: "Teacher Stock" })
      .expect(403);

    await request(app).get(base).set("Authorization", `Bearer ${other.adminToken}`).expect(403);
    const created = await request(app)
      .post(base)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Cross Check" })
      .expect(201);
    const itemId = created.body.data.item.id as string;
    // Same item id under the other school's URL: tenant-scoped 404, not a leak.
    await request(app)
      .get(`/api/v1/schools/${other.schoolId}/inventory/items/${itemId}/movements`)
      .set("Authorization", `Bearer ${other.adminToken}`)
      .expect(404);
  });
});

