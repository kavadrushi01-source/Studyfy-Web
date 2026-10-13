import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { setMailer, stubMailer, type TicketOpenedEmail, type TicketReplyEmail } from "../src/lib/mailer.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

function uid(): string {
  return randomUUID().slice(0, 8);
}

async function registerSchool(
  name: string,
): Promise<{ schoolId: string; slug: string; adminToken: string; adminEmail: string; adminId: string }> {
  const adminEmail = `support-admin-${uid()}@example.com`;
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ schoolName: name, adminName: "Support Admin", adminEmail, adminPassword: "password-123" })
    .expect(201);
  const schoolId = res.body.data.school.id as string;
  const admin = await prisma.user.findUniqueOrThrow({ where: { schoolId_email: { schoolId, email: adminEmail } } });
  return { schoolId, slug: res.body.data.school.slug as string, adminToken: res.body.data.accessToken as string, adminEmail, adminId: admin.id };
}

async function loginOwner(): Promise<{ token: string; userId: string; email: string }> {
  const email = `support-owner-${uid()}@example.com`;
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "PLATFORM_OWNER" } });
  const user = await prisma.user.create({
    data: { schoolId: null, roleId: role.id, email, passwordHash: await bcrypt.hash("owner-pass-123", 4), name: "Support Owner" },
  });
  const res = await request(app).post("/api/v1/auth/login").send({ email, password: "owner-pass-123" }).expect(200);
  return { token: res.body.data.accessToken as string, userId: user.id, email };
}

async function makeTeacher(schoolId: string, slug: string): Promise<{ token: string; userId: string }> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
  const email = `support-teacher-${uid()}@example.com`;
  const password = "teacher-pass-123";
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Support Teacher" },
  });
  await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ schoolSlug: slug, email, password })
    .expect(200);
  return { token: login.body.data.accessToken as string, userId: user.id };
}

async function openTicket(auth: { Authorization: string }, schoolId: string, subject = "Printer jam in office"): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/schools/${schoolId}/support/tickets`)
    .set(auth)
    .send({ subject, priority: "HIGH" })
    .expect(201);
  return res.body.data.id as string;
}

describe("support tickets, school side (§7 #27)", () => {
  it("opens, lists, threads, and audits — staff scoped to their own", async () => {
    const school = await registerSchool(`Support School ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };

    const ticketId = await openTicket(auth, school.schoolId);
    const created = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "TICKET_CREATED" } });
    expect(created).toHaveLength(1);
    expect(created[0]?.actorId).toBe(school.adminId);

    const list = await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets`).set(auth).expect(200);
    expect(list.body.data.tickets).toHaveLength(1);
    expect(list.body.data.tickets[0].status).toBe("OPEN");

    const detail = await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}`).set(auth).expect(200);
    expect(detail.body.data.ticket.messages).toEqual([]);

    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}/messages`)
      .set(auth)
      .send({ body: "It jams on page 3 every time." })
      .expect(201);
    const after = await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}`).set(auth).expect(200);
    expect(after.body.data.ticket.messages).toHaveLength(1);
    const msgRows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "TICKET_MESSAGE" } });
    expect(msgRows).toHaveLength(1);

    // Owner-only fields from a school are rejected, never silently dropped.
    const sneaky = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}/messages`)
      .set(auth)
      .send({ body: "Trust me.", isInternal: true });
    expect(sneaky.status).toBe(400);
    const statusGrab = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}/messages`)
      .set(auth)
      .send({ body: "Closing myself.", status: "CLOSED" });
    expect(statusGrab.status).toBe(400);

    // Staff (teacher/accountant/…) now hold the same support keys: they
    // open threads and reply, but see ONLY their own — the admin keeps the
    // whole-school view.
    const teacher = await makeTeacher(school.schoolId, school.slug);
    const teacherAuth = { Authorization: `Bearer ${teacher.token}` };
    const teacherTicket = await openTicket(teacherAuth, school.schoolId, "Projector bulb gone");

    const teacherList = await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets`).set(teacherAuth).expect(200);
    expect(teacherList.body.data.tickets.map((t: { id: string }) => t.id)).toEqual([teacherTicket]);

    // The admin's thread is scoped 404 for staff — read and reply alike,
    // indistinguishable from an id that never existed.
    await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}`).set(teacherAuth).expect(404);
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}/messages`)
      .set(teacherAuth)
      .send({ body: "Not mine to touch." })
      .expect(404);

    // …while threading their own works, audited under their id.
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets/${teacherTicket}/messages`)
      .set(teacherAuth)
      .send({ body: "It flickers before dying." })
      .expect(201);
    const teacherAudit = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "TICKET_CREATED" } });
    expect(teacherAudit).toHaveLength(2);
    expect(teacherAudit.find((r) => r.entityId === teacherTicket)?.actorId).toBe(teacher.userId);

    // Admin sees BOTH threads — whole-school scope unchanged.
    const adminList = await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets`).set(auth).expect(200);
    expect(adminList.body.data.tickets.map((t: { id: string }) => t.id).sort()).toEqual([ticketId, teacherTicket].sort());

    // Students and parents hold no support key AT ALL — they go through
    // their school (admin/staff), so there is no row to grant them.
    for (const roleName of ["STUDENT", "PARENT"]) {
      const keyless = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
      const grants = await prisma.rolePermission.count({
        where: { roleId: keyless.id, permission: { key: { startsWith: "support." } } },
      });
      expect(grants).toBe(0);
    }

    // Validation + unknown ids fail loud.
    await request(app).post(`/api/v1/schools/${school.schoolId}/support/tickets`).set(auth).send({ subject: "x", priority: "URGENT" }).expect(400);
    await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets/nope`).set(auth).expect(404);
  });

  it("never leaks internal notes to the school, in list or detail", async () => {
    const school = await registerSchool(`Support Privacy School ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const owner = await loginOwner();
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };
    const ticketId = await openTicket(auth, school.schoolId);

    await request(app)
      .post(`/api/v1/platform/tickets/${ticketId}/messages`)
      .set(ownerAuth)
      .send({ body: "Check toner stock before replying.", isInternal: true })
      .expect(201);
    await request(app)
      .post(`/api/v1/platform/tickets/${ticketId}/messages`)
      .set(ownerAuth)
      .send({ body: "Technician visits Thursday.", isInternal: false })
      .expect(201);

    const schoolView = await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}`).set(auth).expect(200);
    expect(schoolView.body.data.ticket.messages).toHaveLength(1);
    expect(schoolView.body.data.ticket.messages[0].body).toBe("Technician visits Thursday.");
    expect(schoolView.body.data.ticket.messages.every((m: { isInternal: boolean }) => m.isInternal === false)).toBe(true);
    // Even the list count hides internal rows.
    const list = await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets`).set(auth).expect(200);
    expect(list.body.data.tickets[0]._count.messages).toBe(1);

    const ownerView = await request(app).get(`/api/v1/platform/tickets/${ticketId}`).set(ownerAuth).expect(200);
    expect(ownerView.body.data.ticket.messages).toHaveLength(2);
    expect(ownerView.body.data.ticket.messages.some((m: { isInternal: boolean }) => m.isInternal === true)).toBe(true);
  });

  it("is tenant-isolated both directions", async () => {
    const a = await registerSchool(`Support Tenant A ${uid()}`);
    const b = await registerSchool(`Support Tenant B ${uid()}`);
    const ticketId = await openTicket({ Authorization: `Bearer ${a.adminToken}` }, a.schoolId);
    const bAuth = { Authorization: `Bearer ${b.adminToken}` };

    await request(app).get(`/api/v1/schools/${b.schoolId}/support/tickets/${ticketId}`).set(bAuth).expect(404);
    await request(app)
      .post(`/api/v1/schools/${b.schoolId}/support/tickets/${ticketId}/messages`)
      .set(bAuth)
      .send({ body: "Hijack attempt." })
      .expect(404);
    // Stranger admin on the platform console.
    await request(app).get(`/api/v1/platform/tickets/${ticketId}`).set(bAuth).expect(403);
    await request(app).get(`/api/v1/platform/tickets`).set(bAuth).expect(403);
    // B's own list is empty — A's rows invisible, not erroring.
    const list = await request(app).get(`/api/v1/schools/${b.schoolId}/support/tickets`).set(bAuth).expect(200);
    expect(list.body.data.tickets).toEqual([]);
  });
});

describe("support tickets, platform side (§7 #27)", () => {
  it("lists cross-tenant, threads with internal, sets status — all audited", async () => {
    const school = await registerSchool(`Support Owner School ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const owner = await loginOwner();
    const ownerAuth = { Authorization: `Bearer ${owner.token}` };
    const ticketId = await openTicket(auth, school.schoolId, "Fee receipt mismatch");

    const all = await request(app).get("/api/v1/platform/tickets").set(ownerAuth).expect(200);
    expect(all.body.data.tickets.some((t: { id: string }) => t.id === ticketId)).toBe(true);

    const reply = await request(app)
      .post(`/api/v1/platform/tickets/${ticketId}/messages`)
      .set(ownerAuth)
      .send({ body: "Credited the difference.", isInternal: false, status: "RESOLVED" })
      .expect(201);
    expect(reply.body.data.status).toBe("RESOLVED");

    const statusRows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "TICKET_STATUS_CHANGE" } });
    expect(statusRows).toHaveLength(1);
    expect(statusRows[0]?.actorId).toBe(owner.userId);
    const msgRows = await prisma.auditLog.findMany({ where: { schoolId: school.schoolId, action: "TICKET_MESSAGE" } });
    expect(msgRows).toHaveLength(1);

    // Status filter + bad enum + unknown id.
    const filtered = await request(app).get("/api/v1/platform/tickets?status=RESOLVED").set(ownerAuth).expect(200);
    expect(filtered.body.data.tickets.some((t: { id: string }) => t.id === ticketId)).toBe(true);
    await request(app).post(`/api/v1/platform/tickets/${ticketId}/messages`).set(ownerAuth).send({ body: "x", status: "ARCHIVED" }).expect(400);
    await request(app).post("/api/v1/platform/tickets/nope/messages").set(ownerAuth).send({ body: "x" }).expect(404);
  });
});

describe("support tickets, suspended school (§13.4 exception)", () => {
  it("lets the suspended admin reach support paths only; teacher stays blocked", async () => {
    const school = await registerSchool(`Support Suspended School ${uid()}`);
    const auth = { Authorization: `Bearer ${school.adminToken}` };
    const owner = await loginOwner();
    const ticketId = await openTicket(auth, school.schoolId);
    // Real teacher enrolled while ACTIVE — its post-suspend login must die.
    const teacherRole = await prisma.role.findUniqueOrThrow({ where: { name: "TEACHER" } });
    const teacherEmail = `support-susp-teacher-${uid()}@example.com`;
    const teacherUser = await prisma.user.create({
      data: { schoolId: school.schoolId, roleId: teacherRole.id, email: teacherEmail, passwordHash: await bcrypt.hash("teacher-pass-123", 4), name: "Suspended Teacher" },
    });
    await prisma.staff.create({ data: { schoolId: school.schoolId, userId: teacherUser.id, designation: "Teacher" } });
    await request(app)
      .post(`/api/v1/platform/schools/${school.schoolId}/suspend`)
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ reason: "Test suspension" })
      .expect(200);

    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ schoolSlug: school.slug, email: school.adminEmail, password: "password-123" })
      .expect(200);
    const adminAuth = { Authorization: `Bearer ${adminLogin.body.data.accessToken as string}` };
    await request(app).get(`/api/v1/schools/${school.schoolId}/support/tickets`).set(adminAuth).expect(200);
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets/${ticketId}/messages`)
      .set(adminAuth)
      .send({ body: "Still need help, please." })
      .expect(201);

    const teacherLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ schoolSlug: school.slug, email: teacherEmail, password: "teacher-pass-123" });
    expect(teacherLogin.status).toBe(403);
    expect(teacherLogin.body.error.code).toBe("SCHOOL_SUSPENDED");
  });
});

describe("ticket notifications (§7 #27)", () => {
  const opened: TicketOpenedEmail[] = [];
  const replies: TicketReplyEmail[] = [];

  beforeAll(() => {
    setMailer({
      ...stubMailer,
      sendTicketOpened: async (email: TicketOpenedEmail) => {
        opened.push(email);
        return "sent";
      },
      sendTicketReply: async (email: TicketReplyEmail) => {
        replies.push(email);
        return "sent";
      },
    });
  });

  afterAll(() => {
    setMailer(null);
  });

  function openedFor(subject: string): TicketOpenedEmail[] {
    return opened.filter((e) => e.subject === subject);
  }
  function repliesFor(subject: string): TicketReplyEmail[] {
    return replies.filter((e) => e.subject === subject);
  }

  it("emails the owners on open and the creator on reply — never the author themselves", async () => {
    const stamp = uid();
    const school = await registerSchool(`Notify School ${stamp}`);
    const adminAuth = { Authorization: `Bearer ${school.adminToken}` };
    const subject = `Notify open ${stamp}`;
    const owner = await loginOwner();

    // Open: every ACTIVE platform owner is notified about the new thread.
    const openedRow = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets`)
      .set(adminAuth)
      .send({ subject, priority: "HIGH" })
      .expect(201);
    const realId = openedRow.body.data.id as string;
    const ownerRecipients = openedFor(subject);
    expect(ownerRecipients.map((e) => e.to)).toContain(owner.email);
    expect(ownerRecipients[0]?.schoolName).toContain(stamp);
    expect(ownerRecipients[0]?.priority).toBe("HIGH");

    // Creator replies to their OWN thread: no self-mail.
    await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets/${realId}/messages`)
      .set(adminAuth)
      .send({ body: "Adding detail." })
      .expect(201);
    expect(repliesFor(subject)).toHaveLength(0);

    // Someone else replies (platform owner, public): the creator is emailed.
    await request(app)
      .post(`/api/v1/platform/tickets/${realId}/messages`)
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ body: "We are on it.", isInternal: false })
      .expect(201);
    const creatorMail = repliesFor(subject);
    expect(creatorMail).toHaveLength(1);
    expect(creatorMail[0]?.to).toBe(school.adminEmail);

    // Internal notes stay silent — no creator mail for owner-only chatter.
    await request(app)
      .post(`/api/v1/platform/tickets/${realId}/messages`)
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ body: "Internal triage note.", isInternal: true })
      .expect(201);
    expect(repliesFor(subject)).toHaveLength(1);
  });

  it("suppresses both notifications for a demo school (§13.11)", async () => {
    const stamp = uid();
    const school = await registerSchool(`Notify Demo ${stamp}`);
    await prisma.school.update({ where: { id: school.schoolId }, data: { isDemo: true } });
    const adminAuth = { Authorization: `Bearer ${school.adminToken}` };
    const subject = `Notify demo ${stamp}`;

    const created = await request(app)
      .post(`/api/v1/schools/${school.schoolId}/support/tickets`)
      .set(adminAuth)
      .send({ subject, priority: "LOW" })
      .expect(201);

    // The mailerFor demo guard wraps the test override itself: nothing
    // lands in the capture arrays even with a recorder installed.
    expect(openedFor(subject)).toHaveLength(0);
    const owner = await loginOwner();
    await request(app)
      .post(`/api/v1/platform/tickets/${created.body.data.id as string}/messages`)
      .set({ Authorization: `Bearer ${owner.token}` })
      .send({ body: "Reply to demo.", isInternal: false })
      .expect(201);
    expect(repliesFor(subject)).toHaveLength(0);
  });
});
