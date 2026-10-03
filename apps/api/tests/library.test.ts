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
      schoolName: `Library School ${uid()}`,
      adminName: "Library Admin",
      adminEmail: `library-admin-${uid()}@example.com`,
      adminPassword: "password-123",
    })
    .expect(201);
  return {
    schoolId: res.body.data.school.id as string,
    slug: res.body.data.school.slug as string,
    adminToken: res.body.data.accessToken as string,
  };
}

async function makeBook(schoolId: string, adminToken: string, copies = 2): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/schools/${schoolId}/library/books`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ title: `Book ${uid()}`, author: "Author A", category: "Fiction", totalCopies: copies })
    .expect(201);
  return res.body.data.book.id as string;
}

async function makePupil(schoolId: string, slug: string): Promise<{ token: string; studentId: string }> {
  const email = `library-pupil-${uid()}@example.com`;
  const password = "pupil-pass-123";
  const cls = await prisma.class.create({ data: { schoolId, name: `Class ${uid()}` } });
  const section = await prisma.section.create({ data: { schoolId, classId: cls.id, name: "A" } });
  const role = await prisma.role.findUniqueOrThrow({ where: { name: "STUDENT" } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Library Pupil" },
  });
  const student = await prisma.student.create({ data: { schoolId, userId: user.id, sectionId: section.id } });
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return { token: login.body.data.accessToken as string, studentId: student.id };
}

async function loginAs(schoolId: string, slug: string, roleName: string): Promise<string> {
  const email = `library-${roleName.toLowerCase()}-${uid()}@example.com`;
  const password = "user-pass-123";
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: `${roleName} User` },
  });
  if (roleName === "TEACHER") {
    await prisma.staff.create({ data: { schoolId, userId: user.id, designation: "Teacher" } });
  }
  const login = await request(app).post("/api/v1/auth/login").send({ email, password, schoolSlug: slug }).expect(200);
  return login.body.data.accessToken as string;
}

describe("Library catalog (§7 Phase 2 #13)", () => {
  it("adds, searches, edits, and removes titles; guards shrink-below-issued and remove-while-out", async () => {
    const { schoolId, adminToken } = await registerSchool();
    const bookId = await makeBook(schoolId, adminToken, 2);

    const search = await request(app)
      .get(`/api/v1/schools/${schoolId}/library/books?search=Author A`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(search.body.data.total).toBe(1);
    expect(search.body.data.books[0].availableCopies).toBe(2);

    // Issue both copies to set up the guards.
    const pupil = await makePupil(schoolId, (await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })).slug);
    const pupil2 = await makePupil(schoolId, (await prisma.school.findUniqueOrThrow({ where: { id: schoolId } })).slug);
    for (const studentId of [pupil.studentId, pupil2.studentId]) {
      await request(app)
        .post(`/api/v1/schools/${schoolId}/library/books/${bookId}/issue`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ studentId })
        .expect(201);
    }

    // 2 total, 2 out: shrinking below the issued count is refused...
    const shrink = await request(app)
      .patch(`/api/v1/schools/${schoolId}/library/books/${bookId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ totalCopies: 1 })
      .expect(409);
    expect(shrink.body.error.code).toBe("COPIES_ISSUED");

    // ...but removing the title while copies are out is refused too.
    const remove = await request(app)
      .delete(`/api/v1/schools/${schoolId}/library/books/${bookId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(409);
    expect(remove.body.error.code).toBe("LOANS_ACTIVE");
  });

  it("issues and returns with exact copy counts; empty shelf and double return are 409", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const bookId = await makeBook(schoolId, adminToken, 1);
    const pupil = await makePupil(schoolId, slug);

    const issued = await request(app)
      .post(`/api/v1/schools/${schoolId}/library/books/${bookId}/issue`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ studentId: pupil.studentId, dueDays: 7 })
      .expect(201);
    const loanId = issued.body.data.loan.id as string;
    expect(new Date(issued.body.data.loan.dueAt).getTime()).toBeGreaterThan(Date.now());

    const shelf = await request(app)
      .get(`/api/v1/schools/${schoolId}/library/books?available=true`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(shelf.body.data.total).toBe(0);

    const empty = await request(app)
      .post(`/api/v1/schools/${schoolId}/library/books/${bookId}/issue`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ studentId: pupil.studentId })
      .expect(409);
    expect(empty.body.error.code).toBe("NO_COPIES_AVAILABLE");

    await request(app)
      .post(`/api/v1/schools/${schoolId}/library/loans/${loanId}/return`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    const double = await request(app)
      .post(`/api/v1/schools/${schoolId}/library/loans/${loanId}/return`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(409);
    expect(double.body.error.code).toBe("ALREADY_RETURNED");

    const back = await request(app)
      .get(`/api/v1/schools/${schoolId}/library/books?available=true`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(back.body.data.total).toBe(1);
  });

  it("prices overdue fines at the school rate, frozen at return", async () => {
    const { schoolId, slug, adminToken } = await registerSchool();
    const bookId = await makeBook(schoolId, adminToken, 2);
    const pupil = await makePupil(schoolId, slug);
    const auth = { Authorization: `Bearer ${adminToken}` };

    // Default rate is ₹5/day.
    const settings = await request(app)
      .get(`/api/v1/schools/${schoolId}/library/settings`)
      .set(auth)
      .expect(200);
    expect(settings.body.data.finePerDay).toBe(5);

    // Bad rates are refused; teachers can't change the policy.
    await request(app)
      .patch(`/api/v1/schools/${schoolId}/library/settings`)
      .set(auth)
      .send({ finePerDay: -1 })
      .expect(400);
    const teacherToken = await loginAs(schoolId, slug, "TEACHER");
    await request(app)
      .patch(`/api/v1/schools/${schoolId}/library/settings`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ finePerDay: 7 })
      .expect(403);

    const issued = await request(app)
      .post(`/api/v1/schools/${schoolId}/library/books/${bookId}/issue`)
      .set(auth)
      .send({ studentId: pupil.studentId })
      .expect(201);
    const loanId = issued.body.data.loan.id as string;
    // Age it ~2.5 days past due (margin either side of the day boundary):
    // live fine is ceil(2.5) × 5 = ₹15.00.
    await prisma.bookLoan.update({
      where: { id: loanId },
      data: { dueAt: new Date(Date.now() - 2.5 * 86400000) },
    });
    const open = await request(app)
      .get(`/api/v1/schools/${schoolId}/library/loans?status=OVERDUE`)
      .set(auth)
      .expect(200);
    expect(open.body.data.loans[0].fine).toBe("15.00");
    expect(open.body.data.finePerDay).toBe(5);

    // Return freezes ₹15.00 even after the rate doubles.
    const returned = await request(app)
      .post(`/api/v1/schools/${schoolId}/library/loans/${loanId}/return`)
      .set(auth)
      .expect(200);
    expect(returned.body.data.loan.fineAmount).toBe("15.00");
    await request(app)
      .patch(`/api/v1/schools/${schoolId}/library/settings`)
      .set(auth)
      .send({ finePerDay: 10 })
      .expect(200);
    const history = await request(app)
      .get(`/api/v1/schools/${schoolId}/library/loans?status=RETURNED`)
      .set(auth)
      .expect(200);
    expect(history.body.data.loans[0].fine).toBe("15.00");
    expect(history.body.data.finePerDay).toBe(10);
  });

  it("pins pupils to own loans, flags overdue, and enforces roles + tenancy", async () => {
    const schoolA = await registerSchool();
    const schoolB = await registerSchool();
    const bookId = await makeBook(schoolA.schoolId, schoolA.adminToken, 3);
    const pupilA = await makePupil(schoolA.schoolId, schoolA.slug);
    const pupilB = await makePupil(schoolA.schoolId, schoolA.slug);

    await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/library/books/${bookId}/issue`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ studentId: pupilA.studentId, dueDays: 1 })
      .expect(201);
    // An overdue loan, aged directly: due yesterday, never returned.
    const overdue = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/library/books/${bookId}/issue`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .send({ studentId: pupilB.studentId, dueDays: 1 })
      .expect(201);
    await prisma.bookLoan.update({
      where: { id: overdue.body.data.loan.id as string },
      data: { dueAt: new Date(Date.now() - 86400000) },
    });

    const overdueList = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/library/loans?status=OVERDUE`)
      .set("Authorization", `Bearer ${schoolA.adminToken}`)
      .expect(200);
    expect(overdueList.body.data.total).toBe(1);
    expect(overdueList.body.data.loans[0].status).toBe("OVERDUE");

    // Pupil A sees exactly one row: their own, true status.
    const mine = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/library/loans`)
      .set("Authorization", `Bearer ${pupilA.token}`)
      .expect(200);
    expect(mine.body.data.total).toBe(1);
    expect(mine.body.data.loans[0].status).toBe("ISSUED");

    // Pupil B asking for A's rows is refused.
    const stranger = await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/library/loans?studentId=${pupilA.studentId}`)
      .set("Authorization", `Bearer ${pupilB.token}`)
      .expect(403);
    expect(stranger.body.error.code).toBe("FORBIDDEN");

    // Stranger school sees nothing (tenant scope → empty, never a leak).
    const cross = await request(app)
      .get(`/api/v1/schools/${schoolB.schoolId}/library/loans`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .expect(200);
    expect(cross.body.data.total).toBe(0);
    await request(app)
      .post(`/api/v1/schools/${schoolB.schoolId}/library/books/${bookId}/issue`)
      .set("Authorization", `Bearer ${schoolB.adminToken}`)
      .send({ studentId: pupilA.studentId })
      .expect(404);

    // Teachers read but never run the desk.
    const teacherToken = await loginAs(schoolA.schoolId, schoolA.slug, "TEACHER");
    await request(app)
      .get(`/api/v1/schools/${schoolA.schoolId}/library/books`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .expect(200);
    const manage = await request(app)
      .post(`/api/v1/schools/${schoolA.schoolId}/library/books`)
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ title: "Nope", author: "Nope", totalCopies: 1 })
      .expect(403);
    expect(manage.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("lets the librarian run the full desk: add, edit, issue, return", async () => {
    const { schoolId, slug } = await registerSchool();
    const email = `desk-librarian-${uid()}@example.com`;
    const password = "lib-pass-123";
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "LIBRARIAN" } });
    await prisma.user.create({
      data: { schoolId, roleId: role.id, email, passwordHash: await bcrypt.hash(password, 4), name: "Desk Librarian" },
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password, schoolSlug: slug })
      .expect(200);
    const lib = { Authorization: `Bearer ${login.body.data.accessToken as string}` };

    const added = await request(app)
      .post(`/api/v1/schools/${schoolId}/library/books`)
      .set(lib)
      .send({ title: `Desk Book ${uid()}`, author: "Desk Author", totalCopies: 1 })
      .expect(201);
    const bookId = added.body.data.book.id as string;

    await request(app)
      .patch(`/api/v1/schools/${schoolId}/library/books/${bookId}`)
      .set(lib)
      .send({ author: "Desk Author Revised" })
      .expect(200);

    const pupil = await makePupil(schoolId, slug);
    const issued = await request(app)
      .post(`/api/v1/schools/${schoolId}/library/books/${bookId}/issue`)
      .set(lib)
      .send({ studentId: pupil.studentId })
      .expect(201);

    await request(app)
      .post(`/api/v1/schools/${schoolId}/library/loans/${issued.body.data.loan.id as string}/return`)
      .set(lib)
      .expect(200);

    const shelf = await request(app)
      .get(`/api/v1/schools/${schoolId}/library/books?available=true`)
      .set(lib)
      .expect(200);
    expect(shelf.body.data.total).toBe(1);
  });
});
