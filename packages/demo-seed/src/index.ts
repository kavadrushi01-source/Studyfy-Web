import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PLANS } from "@studyfy/shared-types";

// ---------------------------------------------------------------------------
// Demo data (DEMO_DATA.md — exact names, do not invent different ones)
// ---------------------------------------------------------------------------

export const DEV_FALLBACK_PASSWORD = "Demo@1234";

// The demo password is public for the synthetic demo schools only. Production
// logins to those schools are read-only and short-lived; the platform owner
// uses a separate private password. The seed resolves demo credentials
// through decideDemoPassword(), never a bare `??` fallback:
// - DEMO_PASSWORD from the environment always wins, everywhere (production
//   rotation, CI, local experiments alike).
// - The documented fallback applies ONLY to a local database seeded with
//   NODE_ENV=development. Anything else without DEMO_PASSWORD requires an
//   explicit value, rather than silently seeding credentials.
// Localhost detection is the backstop: even with NODE_ENV=development, a
// non-local DATABASE_URL still requires the explicit variable.
export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  let host = "";
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return false; // Unparseable URL: treat as remote (fail closed).
  }
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "mysql" || host === "db";
}

export function decideDemoPassword(
  env: { NODE_ENV?: string; DEMO_PASSWORD?: string },
  databaseUrl: string,
): { password: string; source: "environment" | "local fallback" } {
  if (env.DEMO_PASSWORD) {
    return { password: env.DEMO_PASSWORD, source: "environment" };
  }
  if (env.NODE_ENV === "development" && isLocalDatabaseUrl(databaseUrl)) {
    return { password: DEV_FALLBACK_PASSWORD, source: "local fallback" };
  }
  throw new Error(
    "Refusing to seed demo passwords: DEMO_PASSWORD is not set, and the documented Demo@1234 fallback " +
      "applies only to a LOCAL database seeded with NODE_ENV=development (§13.11). " +
      "Set DEMO_PASSWORD explicitly for demo accounts, or run locally with NODE_ENV=development.",
  );
}

// Lazy on purpose: this module is also imported by the test setup (for
// seedRoles/seedPermissions), which must never trip the password gate at
// import time. Resolution happens inside seedDemo(), at seed time.
function resolveDemoPassword(): { password: string; source: "environment" | "local fallback" } {
  return decideDemoPassword(process.env, process.env.DATABASE_URL ?? "");
}
// Cost 10: the RULES.md minimum. The demo hash is reused only for synthetic
// demo-school accounts; the private platform-owner password is separate.
export const DEMO_BCRYPT_COST = 10;

export const OWNER_EMAIL = "owner@studyfy.dev";

const SUBJECTS: { name: string; group: string }[] = [
  { name: "Mathematics", group: "Core" },
  { name: "Physics", group: "Science" },
  { name: "Biology", group: "Science" },
  { name: "Chemistry", group: "Science" },
  { name: "Earth Science", group: "Science" },
  { name: "Environmental Science", group: "Science" },
  { name: "Astronomy / Space Science", group: "Science" },
  { name: "English", group: "Language" },
  { name: "Computer Science", group: "Core" },
];

interface DemoTeacher {
  first: string;
  last: string;
  subjects: string[];
}

interface DemoStudent {
  first: string;
  last: string;
  section: string;
  guardians: { first: string; last: string; relationship: string }[];
}

export interface DemoSchool {
  name: string;
  slug: string;
  city: string;
  state: string;
  brandColor: string;
  emailDomain: string;
  // Paid plan tier shown by this demo school (§16.1, DEMO_DATA.md): SOS is
  // PREMIUM (every module), Ramakrishna is STANDARD (Phase 3 gated) — the
  // side-by-side plan-gating demo only works if the seeds differ.
  plan: "PREMIUM" | "STANDARD";
  adminFirst: string;
  adminLast: string;
  classes: { name: string; sections: string[] }[];
  teachers: DemoTeacher[];
  accountantFirst: string;
  accountantLast: string;
  students: DemoStudent[];
  feeByClass: Record<string, number>;
  eventNotice: string;
}

export const SCHOOLS: DemoSchool[] = [
  {
    name: "School of Science",
    slug: "school-of-science",
    city: "Ahmedabad",
    state: "Gujarat",
    brandColor: "#0D9488",
    emailDomain: "schoolofscience.demo",
    plan: "PREMIUM",
    adminFirst: "Kavita",
    adminLast: "Rao",
    classes: [
      { name: "Grade 9", sections: ["A", "B"] },
      { name: "Grade 10", sections: ["A"] },
    ],
    teachers: [
      { first: "Arjun", last: "Mehta", subjects: ["Mathematics"] },
      { first: "Sneha", last: "Iyer", subjects: ["Physics", "Chemistry"] },
      {
        first: "Rohit",
        last: "Deshmukh",
        subjects: ["Biology", "Earth Science", "Environmental Science", "Astronomy / Space Science"],
      },
      { first: "Fatima", last: "Shaikh", subjects: ["English"] },
      { first: "Karan", last: "Mistry", subjects: ["Computer Science"] },
    ],
    accountantFirst: "Vikram",
    accountantLast: "Solanki",
    students: [
      {
        first: "Aditya",
        last: "Sharma",
        section: "9-A",
        guardians: [
          { first: "Suresh", last: "Sharma", relationship: "Father" },
          { first: "Kavita", last: "Sharma", relationship: "Mother" },
        ],
      },
      { first: "Ishita", last: "Choudhary", section: "9-A", guardians: [{ first: "Ramesh", last: "Choudhary", relationship: "Father" }] },
      { first: "Yash", last: "Gupta", section: "9-A", guardians: [{ first: "Anita", last: "Gupta", relationship: "Mother" }] },
      { first: "Ananya", last: "Joshi", section: "9-B", guardians: [{ first: "Prakash", last: "Joshi", relationship: "Father" }] },
      { first: "Rahul", last: "Verma", section: "9-B", guardians: [{ first: "Sunita", last: "Verma", relationship: "Mother" }] },
      { first: "Priya", last: "Patel", section: "10-A", guardians: [{ first: "Nilesh", last: "Patel", relationship: "Father" }] },
      { first: "Aarav", last: "Nair", section: "10-A", guardians: [{ first: "Deepa", last: "Nair", relationship: "Mother" }] },
      { first: "Meera", last: "Pillai", section: "10-A", guardians: [{ first: "Suresh", last: "Pillai", relationship: "Father" }] },
    ],
    feeByClass: { "Grade 9": 14500, "Grade 10": 15800 },
    eventNotice: "Annual Science Exhibition",
  },
  {
    name: "Ramakrishna School",
    slug: "ramakrishna-school",
    city: "Rajkot",
    state: "Gujarat",
    brandColor: "#7F1D1D",
    emailDomain: "ramakrishnaschool.demo",
    plan: "STANDARD",
    adminFirst: "S",
    adminLast: "Venkataraman",
    classes: [
      { name: "Grade 9", sections: ["A"] },
      { name: "Grade 10", sections: ["A", "B"] },
    ],
    teachers: [
      { first: "Anjali", last: "Kulkarni", subjects: ["Mathematics"] },
      { first: "Deepak", last: "Chandran", subjects: ["Physics", "Chemistry"] },
      {
        first: "Radha",
        last: "Krishnan",
        subjects: ["Biology", "Earth Science", "Environmental Science", "Astronomy / Space Science"],
      },
      { first: "Michael", last: "D'Souza", subjects: ["English"] },
      { first: "Priyanka", last: "Bose", subjects: ["Computer Science"] },
    ],
    accountantFirst: "Ramesh",
    accountantLast: "Iyer",
    students: [
      { first: "Krishna", last: "Murthy", section: "9-A", guardians: [{ first: "Sunita", last: "Murthy", relationship: "Mother" }] },
      { first: "Sanjana", last: "Rao", section: "9-A", guardians: [{ first: "Geeta", last: "Rao", relationship: "Mother" }] },
      { first: "Vivek", last: "Pillai", section: "9-A", guardians: [{ first: "Anand", last: "Pillai", relationship: "Father" }] },
      { first: "Divya", last: "Menon", section: "10-A", guardians: [{ first: "Ravi", last: "Menon", relationship: "Father" }] },
      { first: "Arjun", last: "Reddy", section: "10-A", guardians: [{ first: "Lakshmi", last: "Reddy", relationship: "Mother" }] },
      { first: "Lakshmi", last: "Narayan", section: "10-B", guardians: [{ first: "Suresh", last: "Narayan", relationship: "Father" }] },
      { first: "Rohan", last: "Kamath", section: "10-B", guardians: [{ first: "Meena", last: "Kamath", relationship: "Mother" }] },
      { first: "Neha", last: "Bhatt", section: "10-B", guardians: [{ first: "Ashok", last: "Bhatt", relationship: "Father" }] },
    ],
    feeByClass: { "Grade 9": 12800, "Grade 10": 13900 },
    eventNotice: "Annual Day Celebration",
  },
];

function emailFor(first: string, last: string, domain: string): string {
  const clean = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");
  return `${clean(first)}.${clean(last)}@${domain}`;
}

async function upsertUser(
  db: PrismaClient,
  schoolId: string,
  roleId: string,
  email: string,
  name: string,
  passwordHash: string,
): Promise<string> {
  const existing = await db.user.findUnique({ where: { schoolId_email: { schoolId, email } } });
  if (existing) {
    return existing.id;
  }
  const created = await db.user.create({
    data: { schoolId, roleId, email, passwordHash, name },
  });
  return created.id;
}

function resolveOwnerPassword(): string {
  if (process.env.OWNER_PASSWORD) {
    if (process.env.OWNER_PASSWORD.length < 16 || process.env.OWNER_PASSWORD === process.env.DEMO_PASSWORD) {
      throw new Error("OWNER_PASSWORD must be private, different from DEMO_PASSWORD, and at least 16 characters.");
    }
    return process.env.OWNER_PASSWORD;
  }
  if (process.env.NODE_ENV === "development" && isLocalDatabaseUrl(process.env.DATABASE_URL ?? "")) {
    return DEV_FALLBACK_PASSWORD;
  }
  throw new Error(
    "Refusing to create the platform owner without OWNER_PASSWORD. Set a private password in the environment; " +
      "the public demo password must never be used for the owner account.",
  );
}

async function seedOwner(db: PrismaClient): Promise<void> {
  const role = await db.role.findUnique({ where: { name: "PLATFORM_OWNER" } });
  if (!role) {
    throw new Error("PLATFORM_OWNER role must be seeded before the owner account.");
  }
  // No upsert possible: the unique key (schoolId, email) contains NULL.
  // findFirst + create is the §13.4-sanctioned path (seed-only creation).
  const existing = await db.user.findFirst({ where: { schoolId: null, email: OWNER_EMAIL } });
  if (!existing) {
    const passwordHash = await bcrypt.hash(resolveOwnerPassword(), DEMO_BCRYPT_COST);
    await db.user.create({
      data: { schoolId: null, roleId: role.id, email: OWNER_EMAIL, passwordHash, name: "Admin User" },
    });
  }
}

// Demo billing history (§16.1, DEMO_DATA.md): an ACTIVE subscription row +
// three PAID invoices (Sep–Nov 2026), so the owner revenue/plan boards
// aren't empty in a walkthrough. Fictional seed data for dev/demo only —
// paidMethod MANUAL labels them test payments, never real revenue (§16.1,
// §8.1). Idempotent: fixed periods (skipped when present) and deterministic
// numbers. Demo schools are isDemo-exempt from the billing cycle, so these
// rows never mutate after seeding. Prices come from the single PLANS config
// (§16.1 — never copied).
async function seedSubscriptions(
  db: PrismaClient,
  schoolId: string,
  slug: string,
  plan: "PREMIUM" | "STANDARD",
): Promise<void> {
  const tag = slug === "school-of-science" ? "SOS" : "RK";
  const price = PLANS[plan].pricePaise;
  const gstTotal = Math.round((price * 18) / 100);
  const cgst = Math.round(gstTotal / 2);
  const sgst = gstTotal - cgst;
  const months = [
    { y: 2026, m: 9 },
    { y: 2026, m: 10 },
    { y: 2026, m: 11 },
  ];
  let i = 0;
  for (const { y, m } of months) {
    i += 1;
    const periodStart = new Date(Date.UTC(y, m - 1, 1));
    const periodEnd = new Date(Date.UTC(y, m, 0));
    const existing = await db.subscriptionInvoice.findFirst({ where: { schoolId, periodStart } });
    if (!existing) {
      await db.subscriptionInvoice.create({
        data: {
          schoolId,
          invoiceNumber: `STY/26-27/${tag}${i}`,
          financialYear: "2026-27",
          amountPaise: price,
          cgstPaise: cgst,
          sgstPaise: sgst,
          igstPaise: 0,
          status: "PAID",
          periodStart,
          periodEnd,
          paidAt: periodEnd,
          paidMethod: "MANUAL",
        },
      });
    }
  }
  await db.subscription.upsert({
    where: { schoolId },
    update: { plan, status: "ACTIVE" },
    create: {
      schoolId,
      plan,
      status: "ACTIVE",
      currentPeriodStart: new Date(Date.UTC(2026, 10, 1)),
      currentPeriodEnd: new Date(Date.UTC(2026, 10, 30)),
    },
  });
}

async function seedSchool(db: PrismaClient, spec: DemoSchool, roles: Map<string, string>, passwordHash: string): Promise<void> {  const required = ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STUDENT", "PARENT", "LIBRARIAN", "TRANSPORT_MANAGER"] as const;
  for (const name of required) {
    if (!roles.get(name)) {
      throw new Error(`Role ${name} must be seeded before demo schools.`);
    }
  }

  // ACTIVE, never TRIAL: a "trial ending" countdown would be a wrong
  // impression in a walkthrough (DEMO_DATA.md). trialEndsAt still required
  // by the schema — set a year out, inert while ACTIVE.
  // isDemo = true: these are the portfolio demo schools (§13.11) — exempt
  // from billing automation/suspension, outbound mail suppressed, the only
  // schools the nightly reset may touch. plan per DEMO_DATA.md (§16.1).
  const school = await db.school.upsert({
    where: { slug: spec.slug },
    update: {
      name: spec.name,
      city: spec.city,
      state: spec.state,
      timezone: "Asia/Kolkata",
      subscriptionStatus: "ACTIVE",
      brandColor: spec.brandColor,
      isDemo: true,
      plan: spec.plan,
    },
    create: {
      name: spec.name,
      slug: spec.slug,
      city: spec.city,
      state: spec.state,
      timezone: "Asia/Kolkata",
      subscriptionStatus: "ACTIVE",
      trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      brandColor: spec.brandColor,
      isDemo: true,
      plan: spec.plan,
    },
  });

  for (const subject of SUBJECTS) {
    await db.subject.upsert({
      where: { schoolId_name: { schoolId: school.id, name: subject.name } },
      update: { group: subject.group },
      create: { schoolId: school.id, name: subject.name, group: subject.group },
    });
  }

  await seedSubscriptions(db, school.id, spec.slug, spec.plan);

  const year = await db.academicYear.upsert({
    where: { schoolId_name: { schoolId: school.id, name: "2026-27" } },
    update: { isCurrent: true },
    create: {
      schoolId: school.id,
      name: "2026-27",
      startDate: new Date("2026-04-01T00:00:00Z"),
      endDate: new Date("2027-03-31T00:00:00Z"),
      isCurrent: true,
    },
  });

  const sectionIds = new Map<string, string>();
  const classIds = new Map<string, string>();
  for (const cls of spec.classes) {
    const classRow = await db.class.upsert({
      where: { schoolId_name: { schoolId: school.id, name: cls.name } },
      update: {},
      create: { schoolId: school.id, academicYearId: year.id, name: cls.name },
    });
    classIds.set(cls.name, classRow.id);
    for (const section of cls.sections) {
      const key = `${cls.name.split(" ")[1]}-${section}`;
      const sectionRow = await db.section.upsert({
        where: { classId_name: { classId: classRow.id, name: section } },
        update: {},
        create: { schoolId: school.id, classId: classRow.id, name: section },
      });
      sectionIds.set(key, sectionRow.id);
    }
  }

  const adminEmail = emailFor(spec.adminFirst, spec.adminLast, spec.emailDomain);
  const adminId = await upsertUser(
    db,
    school.id,
    roles.get("SCHOOL_ADMIN") ?? "",
    adminEmail,
    `${spec.adminFirst} ${spec.adminLast}`,
    passwordHash,
  );

  const teacherStaffIds: string[] = [];
  for (const teacher of spec.teachers) {
    const email = emailFor(teacher.first, teacher.last, spec.emailDomain);
    const userId = await upsertUser(
      db,
      school.id,
      roles.get("TEACHER") ?? "",
      email,
      `${teacher.first} ${teacher.last}`,
      passwordHash,
    );
    const staff = await db.staff.upsert({
      where: { userId },
      update: { designation: "Teacher" },
      create: { schoolId: school.id, userId, designation: "Teacher" },
    });
    teacherStaffIds.push(staff.id);
    // Qualifications (§9.1 teacher_subjects): what this teacher may be
    // scheduled to teach — from DEMO_DATA.md's per-teacher subject lists.
    for (const subjectName of teacher.subjects) {
      const subject = await db.subject.findUnique({
        where: { schoolId_name: { schoolId: school.id, name: subjectName } },
      });
      if (!subject) {
        throw new Error(`Subject ${subjectName} must be seeded before teacher qualifications.`);
      }
      const existing = await db.teacherSubject.findUnique({
        where: { staffId_subjectId: { staffId: staff.id, subjectId: subject.id } },
      });
      if (!existing) {
        await db.teacherSubject.create({
          data: { schoolId: school.id, staffId: staff.id, subjectId: subject.id },
        });
      }
    }
  }

  // Class-teacher assignments (§9.1): deterministic cycle — first teacher
  // owns the first section, and so on (SOS 9-A → Arjun Mehta, 9-B → Sneha
  // Iyer, 10-A → Rohit Deshmukh; Ramakrishna 9-A → Anjali Kulkarni,
  // 10-A → Deepak Chandran, 10-B → Radha Krishnan). Re-run safe (update).
  const orderedSections = [...sectionIds.values()];
  for (let i = 0; i < orderedSections.length; i += 1) {
    const sectionId = orderedSections[i];
    const staffId = teacherStaffIds[i % teacherStaffIds.length];
    if (sectionId && staffId) {
      await db.section.update({ where: { id: sectionId }, data: { classTeacherId: staffId } });
    }
  }

  const accountantEmail = emailFor(spec.accountantFirst, spec.accountantLast, spec.emailDomain);
  const accountantUserId = await upsertUser(
    db,
    school.id,
    roles.get("ACCOUNTANT") ?? "",
    accountantEmail,
    `${spec.accountantFirst} ${spec.accountantLast}`,
    passwordHash,
  );
  await db.staff.upsert({
    where: { userId: accountantUserId },
    update: { designation: "Accountant" },
    create: { schoolId: school.id, userId: accountantUserId, designation: "Accountant" },
  });

  // Librarian + Transport Manager demo logins (one staff row each, so
  // staffSelfScope resolves and their boards show own-scope data).
  // Names avoid every seeded guardian/student first+last pair per school
  // (upsertUser keys on email — a collision would merge two people).
  const extraStaff: { first: string; last: string; role: string; designation: string }[] = [
    { first: "Lata", last: "Nair", role: "LIBRARIAN", designation: "Librarian" },
    { first: "Ravi", last: "Nair", role: "TRANSPORT_MANAGER", designation: "Transport Manager" },
  ];
  for (const extra of extraStaff) {
    const email = emailFor(extra.first, extra.last, spec.emailDomain);
    const userId = await upsertUser(db, school.id, roles.get(extra.role) ?? "", email, `${extra.first} ${extra.last}`, passwordHash);
    await db.staff.upsert({
      where: { userId },
      update: { designation: extra.designation },
      create: { schoolId: school.id, userId, designation: extra.designation },
    });
  }

  interface SeededStudent {
    studentId: string;
    className: string;
    index: number;
  }
  const seeded: SeededStudent[] = [];
  for (let index = 0; index < spec.students.length; index += 1) {
    const student = spec.students[index];
    if (!student) {
      continue;
    }
    const sectionId = sectionIds.get(student.section);
    if (!sectionId) {
      throw new Error(`Unknown section ${student.section} for ${student.first} ${student.last}`);
    }
    const email = emailFor(student.first, student.last, spec.emailDomain);
    const userId = await upsertUser(
      db,
      school.id,
      roles.get("STUDENT") ?? "",
      email,
      `${student.first} ${student.last}`,
      passwordHash,
    );
    const profile = await db.student.upsert({
      where: { userId },
      // admissionNo set on update too: re-running the seed backfills rows
      // admitted before numbers existed, so the roster never shows blanks.
      update: { sectionId, admissionNo: `ADM-${school.slug === "school-of-science" ? "SOS" : "RKS"}-2026-${String(index + 1).padStart(3, "0")}` },
      create: {
        schoolId: school.id,
        userId,
        sectionId,
        admissionNo: `ADM-${school.slug === "school-of-science" ? "SOS" : "RKS"}-2026-${String(index + 1).padStart(3, "0")}`,
      },
    });
    for (const guardian of student.guardians) {
      const guardianEmail = emailFor(guardian.first, guardian.last, spec.emailDomain);
      const guardianId = await upsertUser(
        db,
        school.id,
        roles.get("PARENT") ?? "",
        guardianEmail,
        `${guardian.first} ${guardian.last}`,
        passwordHash,
      );
      const link = await db.studentGuardian.findUnique({
        where: { studentId_parentId: { studentId: profile.id, parentId: guardianId } },
      });
      if (!link) {
        await db.studentGuardian.create({
          data: {
            schoolId: school.id,
            studentId: profile.id,
            parentId: guardianId,
            relationship: guardian.relationship,
          },
        });
      }
    }
    const className = student.section.startsWith("9-") ? "Grade 9" : "Grade 10";
    seeded.push({ studentId: profile.id, className, index });
  }

  await seedFees(db, school.id, year.id, classIds, seeded, spec.feeByClass, accountantUserId);
  await seedExam(db, school.id, year.id, seeded);
  await seedRemarks(db, school.id, seeded);
  const marker = teacherStaffIds[0];
  if (marker) {
    await seedAttendance(db, school.id, seeded, marker);
  }
  const mathTeacher = teacherStaffIds[0];
  if (mathTeacher) {
    await seedHomework(db, school.id, sectionIds, mathTeacher, seeded);
  }
  await seedNotices(db, school.id, classIds, adminId, spec.eventNotice);
  await seedEnquiries(db, school.id, adminId);
  await seedBooks(db, school.id);
  await seedTransport(db, school.id);
}

async function seedFees(
  db: PrismaClient,
  schoolId: string,
  academicYearId: string,
  classIds: Map<string, string>,
  students: { studentId: string; className: string; index: number }[],
  feeByClass: Record<string, number>,
  receivedById: string,
): Promise<void> {
  const day = 24 * 60 * 60 * 1000;
  for (const entry of classIds) {
    const [className, classId] = entry;
    const amount = feeByClass[className];
    if (amount === undefined) {
      continue;
    }
    await db.feeStructure.upsert({
      where: { classId_name: { classId, name: "Term 1 Tuition" } },
      update: { amount, term: "Term 1", category: "TUITION" },
      create: { schoolId, classId, academicYearId, name: "Term 1 Tuition", amount, term: "Term 1", category: "TUITION" },
    });
  }
  for (const student of students) {
    const classId = classIds.get(student.className);
    if (!classId) {
      continue;
    }
    const structure = await db.feeStructure.findUnique({
      where: { classId_name: { classId, name: "Term 1 Tuition" } },
    });
    if (!structure) {
      continue;
    }
    // Deterministic mix per school: 6 Paid, 1 Pending (idx 6), 1 Overdue (idx 7).
    const slot = student.index % 8;
    const status: "PENDING" | "OVERDUE" | "PAID" = slot === 6 ? "PENDING" : slot === 7 ? "OVERDUE" : "PAID";
    const dueDate = new Date(Date.now() + (status === "PENDING" ? 15 * day : -30 * day));
    let invoice = await db.feeInvoice.findFirst({
      where: { schoolId, studentId: student.studentId, structureId: structure.id },
    });
    if (!invoice) {
      invoice = await db.feeInvoice.create({
        data: {
          schoolId,
          studentId: student.studentId,
          structureId: structure.id,
          amount: structure.amount,
          amountPaid: status === "PAID" ? structure.amount : 0,
          status,
          dueDate,
        },
      });
    }
    if (status === "PAID") {
      const payment = await db.feePayment.findFirst({ where: { schoolId, invoiceId: invoice.id } });
      if (!payment) {
        await db.feePayment.create({
          data: {
            schoolId,
            invoiceId: invoice.id,
            amount: structure.amount,
            method: "CASH",
            receivedById,
            paidAt: new Date(Date.now() - 20 * day),
          },
        });
      }
    }
  }
  // Term 2: EVERY student carries a PENDING invoice, so every parent has a
  // real amount to pay when exercising the payment flow (idempotent — the
  // nightly demo reset re-runs this safely).
  for (const entry of classIds) {
    const [className, classId] = entry;
    const amount = feeByClass[className];
    if (amount === undefined) {
      continue;
    }
    await db.feeStructure.upsert({
      where: { classId_name: { classId, name: "Term 2 Tuition" } },
      update: { amount, term: "Term 2", category: "TUITION" },
      create: { schoolId, classId, academicYearId, name: "Term 2 Tuition", amount, term: "Term 2", category: "TUITION" },
    });
  }
  for (const student of students) {
    const classId = classIds.get(student.className);
    if (!classId) {
      continue;
    }
    const term2 = await db.feeStructure.findUnique({
      where: { classId_name: { classId, name: "Term 2 Tuition" } },
    });
    if (!term2) {
      continue;
    }
    const hasTerm2 = await db.feeInvoice.findFirst({
      where: { schoolId, studentId: student.studentId, structureId: term2.id },
    });
    if (!hasTerm2) {
      await db.feeInvoice.create({
        data: {
          schoolId,
          studentId: student.studentId,
          structureId: term2.id,
          amount: term2.amount,
          amountPaid: 0,
          status: "PENDING",
          dueDate: new Date(Date.now() + 20 * day),
        },
      });
    }
  }
}

async function seedExam(
  db: PrismaClient,
  schoolId: string,
  academicYearId: string,
  students: { studentId: string; index: number }[],
): Promise<void> {
  const examRow = await db.exam.upsert({
    where: { id: `seed-${schoolId}-unit-test-1` },
    update: { name: "Unit Test 1" },
    create: { id: `seed-${schoolId}-unit-test-1`, schoolId, academicYearId, name: "Unit Test 1" },
  });
  for (const [subjectIndex, subjectName] of ["Mathematics", "English", "Physics"].entries()) {
    const subject = await db.subject.findUnique({ where: { schoolId_name: { schoolId, name: subjectName } } });
    if (!subject) {
      continue;
    }
    const examSubject = await db.examSubject.upsert({
      where: { examId_subjectId: { examId: examRow.id, subjectId: subject.id } },
      update: {},
      create: { schoolId, examId: examRow.id, subjectId: subject.id, maxMarks: 50 },
    });
    for (const student of students) {
      // Deterministic 31..48 spread — varied, never uniform.
      const marks = 31 + ((student.index * 17 + subjectIndex * 23) % 18);
      await db.mark.upsert({
        where: { examSubjectId_studentId: { examSubjectId: examSubject.id, studentId: student.studentId } },
        update: { marksObtained: marks },
        create: { schoolId, examSubjectId: examSubject.id, studentId: student.studentId, marksObtained: marks },
      });
    }
  }
}

async function seedRemarks(
  db: PrismaClient,
  schoolId: string,
  students: { studentId: string; index: number }[],
): Promise<void> {
  // Review-queue demo data (§7 Phase 3 #18): the first pupil of each school
  // carries one signed TEACHER remark and one unreviewed AI draft on Unit
  // Test 1, so the report-page review flow is demonstrable (and e2e-covered)
  // without calling Groq. Deterministic ids — re-runs upsert, never duplicate.
  const first = students[0];
  const exam = await db.exam.findUnique({ where: { id: `seed-${schoolId}-unit-test-1` } });
  if (!first || !exam) {
    return;
  }
  await db.examRemark.upsert({
    where: { id: `seed-${schoolId}-remark-signed` },
    update: {
      remark: "Consistent effort across all subjects this term — keep it up.",
      generatedBy: "TEACHER",
      reviewed: true,
    },
    create: {
      id: `seed-${schoolId}-remark-signed`,
      schoolId,
      studentId: first.studentId,
      examId: exam.id,
      remark: "Consistent effort across all subjects this term — keep it up.",
      generatedBy: "TEACHER",
      reviewed: true,
    },
  });
  await db.examRemark.upsert({
    where: { id: `seed-${schoolId}-remark-draft` },
    update: {
      remark: "This student shows steady progress with room to grow in problem-solving speed.",
      generatedBy: "AI",
      reviewed: false,
    },
    create: {
      id: `seed-${schoolId}-remark-draft`,
      schoolId,
      studentId: first.studentId,
      examId: exam.id,
      remark: "This student shows steady progress with room to grow in problem-solving speed.",
      generatedBy: "AI",
      reviewed: false,
    },
  });
}

function lastSchoolDays(count: number): Date[] {
  // Last `count` days excluding Sundays (weekly holiday).
  const days: Date[] = [];
  const cursor = new Date();
  // Midnight UTC: attendance.date is @db.Date (day precision) — a where
  // clause carrying a time component would never match the stored day,
  // turning every re-run upsert into a P2002. Keep them day-clean.
  cursor.setUTCHours(0, 0, 0, 0);
  while (days.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (cursor.getUTCDay() === 0) {
      continue;
    }
    days.push(new Date(cursor.getTime()));
  }
  return days.reverse();
}

async function seedAttendance(
  db: PrismaClient,
  schoolId: string,
  students: { studentId: string; index: number }[],
  markedById: string,
): Promise<void> {
  const sectionByStudent = new Map<string, string>();
  for (const student of students) {
    const profile = await db.student.findUnique({ where: { id: student.studentId } });
    if (profile) {
      sectionByStudent.set(student.studentId, profile.sectionId);
    }
  }
  const days = lastSchoolDays(15);
  for (const student of students) {
    const sectionId = sectionByStudent.get(student.studentId);
    if (!sectionId) {
      continue;
    }
    for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
      const date = days[dayIndex];
      if (!date) {
        continue;
      }
      // Deterministic ~90% present with scattered Absent/Late per student.
      const status: "ABSENT" | "LATE" | "PRESENT" =
        (dayIndex + student.index) % 11 === 0 ? "ABSENT" : (dayIndex * 3 + student.index) % 13 === 0 ? "LATE" : "PRESENT";
      await db.attendance.upsert({
        where: { studentId_date: { studentId: student.studentId, date } },
        update: { status },
        create: { schoolId, studentId: student.studentId, sectionId, date, status, markedById },
      });
    }
  }
}

async function seedHomework(
  db: PrismaClient,
  schoolId: string,
  sectionIds: Map<string, string>,
  teacherStaffId: string,
  students: { studentId: string; index: number }[],
): Promise<void> {
  const day = 24 * 60 * 60 * 1000;
  const math = await db.subject.findUnique({ where: { schoolId_name: { schoolId, name: "Mathematics" } } });
  if (!math) {
    return;
  }
  const studentsBySection = new Map<string, { studentId: string; index: number }[]>();
  for (const student of students) {
    const profile = await db.student.findUnique({ where: { id: student.studentId } });
    if (!profile) {
      continue;
    }
    const list = studentsBySection.get(profile.sectionId) ?? [];
    list.push(student);
    studentsBySection.set(profile.sectionId, list);
  }
  for (const entry of sectionIds) {
    const [, sectionId] = entry;
    const inSection = studentsBySection.get(sectionId) ?? [];
    // HW1: past due, graded, most submissions recorded.
    let hw1 = await db.homework.findFirst({ where: { schoolId, sectionId, title: "Algebra Worksheet 1" } });
    if (!hw1) {
      hw1 = await db.homework.create({
        data: {
          schoolId,
          sectionId,
          subjectId: math.id,
          teacherId: teacherStaffId,
          title: "Algebra Worksheet 1",
          description: "Solve problems 1-20 from chapter 3.",
          dueDate: new Date(Date.now() - 5 * day),
        },
      });
    }
    for (const student of inSection) {
      if (student.index % 4 === 3) {
        continue; // one missing submission per section, on purpose
      }
      await db.homeworkSubmission.upsert({
        where: { homeworkId_studentId: { homeworkId: hw1.id, studentId: student.studentId } },
        update: { status: "GRADED" },
        create: {
          schoolId,
          homeworkId: hw1.id,
          studentId: student.studentId,
          content: "Solved all problems.",
          status: "GRADED",
        },
      });
    }
    // HW2: future due, still open.
    let hw2 = await db.homework.findFirst({ where: { schoolId, sectionId, title: "Geometry Problems" } });
    if (!hw2) {
      hw2 = await db.homework.create({
        data: {
          schoolId,
          sectionId,
          subjectId: math.id,
          teacherId: teacherStaffId,
          title: "Geometry Problems",
          description: "Constructions from chapter 5, due next week.",
          dueDate: new Date(Date.now() + 7 * day),
        },
      });
    }
    for (const student of inSection.slice(0, 2)) {
      await db.homeworkSubmission.upsert({
        where: { homeworkId_studentId: { homeworkId: hw2.id, studentId: student.studentId } },
        update: {},
        create: {
          schoolId,
          homeworkId: hw2.id,
          studentId: student.studentId,
          content: "Early submission.",
          status: "SUBMITTED",
        },
      });
    }
  }
}

async function seedNotices(
  db: PrismaClient,
  schoolId: string,
  classIds: Map<string, string>,
  createdById: string,
  eventNotice: string,
): Promise<void> {
  const day = 24 * 60 * 60 * 1000;
  const grade10 = classIds.get("Grade 10");
  const notices: { title: string; body: string; classId?: string }[] = [
    {
      title: "Parent-Teacher Meeting on Saturday",
      body: "All parents are requested to attend the parent-teacher meeting this Saturday at 10 AM in the school hall.",
    },
    {
      title: "Half-Day on Friday",
      body: "School will run a half-day this Friday on account of staff training. Buses leave at 12:30 PM.",
    },
    { title: eventNotice, body: `${eventNotice} registrations are open at the front office.`, classId: grade10 },
  ];
  for (let index = 0; index < notices.length; index += 1) {
    const notice = notices[index];
    if (!notice) {
      continue;
    }
    const existing = await db.notice.findFirst({ where: { schoolId, title: notice.title } });
    if (existing) {
      continue;
    }
    await db.notice.create({
      data: {
        schoolId,
        title: notice.title,
        body: notice.body,
        target: notice.classId ? "CLASS" : "SCHOOL",
        classId: notice.classId,
        createdById,
        createdAt: new Date(Date.now() - (3 - index) * day),
      },
    });
  }
}

async function seedEnquiries(db: PrismaClient, schoolId: string, adminId: string): Promise<void> {
  // Deterministic pipeline demo (idempotent by name): one enquiry per
  // stage so the CRM board shows the whole funnel on first open.
  const day = 86400000;
  const rows: { name: string; phone: string; message: string; status: string; ageDays: number; note?: string }[] = [
    { name: "Prospective Parent A", phone: "9000000001", message: "Admission for Grade 1 next year.", status: "NEW", ageDays: 1 },
    { name: "Prospective Parent B", phone: "9000000002", message: "Fee structure for Grade 6, please.", status: "CONTACTED", ageDays: 4, note: "Called — asked about transport routes." },
    { name: "Prospective Parent C", phone: "9000000003", message: "Visited the school; wants to meet the principal.", status: "VISITED", ageDays: 9, note: "Campus tour done Saturday." },
    { name: "Prospective Parent D", phone: "9000000004", message: "Sibling of an existing student.", status: "ADMITTED", ageDays: 15, note: "Admission form collected at the office." },
  ];
  for (const row of rows) {
    const existing = await db.enquiry.findFirst({ where: { schoolId, name: row.name } });
    if (existing) {
      continue;
    }
    const created = await db.enquiry.create({
      data: {
        schoolId,
        name: row.name,
        phone: row.phone,
        message: row.message,
        status: row.status,
        createdAt: new Date(Date.now() - row.ageDays * day),
      },
    });
    if (row.note) {
      await db.enquiryNote.create({
        data: { schoolId, enquiryId: created.id, authorId: adminId, body: row.note },
      });
    }
  }
}

async function seedBooks(db: PrismaClient, schoolId: string): Promise<void> {
  // Deterministic shelf demo (idempotent by title): a small classics +
  // curriculum shelf so the catalog opens non-empty on first visit.
  const books: { title: string; author: string; category: string; totalCopies: number }[] = [
    { title: "Mathematics Grade 9", author: "NCERT", category: "Textbook", totalCopies: 12 },
    { title: "Science Grade 9", author: "NCERT", category: "Textbook", totalCopies: 12 },
    { title: "A Brief History of Time", author: "Stephen Hawking", category: "Science", totalCopies: 3 },
    { title: "The Diary of a Young Girl", author: "Anne Frank", category: "Biography", totalCopies: 4 },
    { title: "Malgudi Days", author: "R.K. Narayan", category: "Fiction", totalCopies: 5 },
    { title: "Wings of Fire", author: "A.P.J. Abdul Kalam", category: "Biography", totalCopies: 4 },
    { title: "The Blue Umbrella", author: "Ruskin Bond", category: "Fiction", totalCopies: 6 },
    { title: "General Knowledge 2026", author: "Manohar Pandey", category: "Reference", totalCopies: 2 },
  ];
  for (const book of books) {
    const existing = await db.book.findFirst({ where: { schoolId, title: book.title } });
    if (existing) {
      continue;
    }
    await db.book.create({
      data: { ...book, schoolId, availableCopies: book.totalCopies },
    });
  }
}

async function seedTransport(db: PrismaClient, schoolId: string): Promise<void> {
  // Deterministic depot demo (idempotent by name/number): two routes with
  // ordered stop runs plus two fleet buses, so the board opens non-empty.
  const routes: { name: string; stops: { name: string; pickupTime: string }[] }[] = [
    {
      name: "Route 1 · North Loop",
      stops: [
        { name: "Depot", pickupTime: "07:00" },
        { name: "Lakeview", pickupTime: "07:12" },
        { name: "Market", pickupTime: "07:24" },
        { name: "School Gate", pickupTime: "07:40" },
      ],
    },
    {
      name: "Route 2 · South Loop",
      stops: [
        { name: "Depot", pickupTime: "07:00" },
        { name: "Temple Stop", pickupTime: "07:15" },
        { name: "School Gate", pickupTime: "07:38" },
      ],
    },
  ];
  for (const spec of routes) {
    const existing = await db.transportRoute.findFirst({ where: { schoolId, name: spec.name } });
    if (!existing) {
      await db.transportRoute.create({ data: { schoolId, name: spec.name, stops: spec.stops } });
    }
  }
  const buses = [
    { registrationNumber: "SCH-01", driverName: "Ramesh Driver" },
    { registrationNumber: "SCH-02", driverName: "Suresh Driver" },
  ];
  for (const bus of buses) {
    const existing = await db.vehicle.findFirst({ where: { schoolId, registrationNumber: bus.registrationNumber } });
    if (!existing) {
      await db.vehicle.create({
        data: { schoolId, registrationNumber: bus.registrationNumber, capacity: 40, driverName: bus.driverName },
      });
    }
  }
}

export async function seedDemo(db: PrismaClient): Promise<void> {
  const roles = new Map<string, string>();
  for (const name of ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STUDENT", "PARENT", "LIBRARIAN", "TRANSPORT_MANAGER"] as const) {
    const role = await db.role.findUnique({ where: { name } });
    if (role) {
      roles.set(name, role.id);
    }
  }
  // Gate runs here (not at import): importing this module for roles-only
  // seeding must never throw.
  const { password } = resolveDemoPassword();
  const passwordHash = await bcrypt.hash(password, DEMO_BCRYPT_COST);
  await seedOwner(db);
  for (const spec of SCHOOLS) {
    await seedSchool(db, spec, roles, passwordHash);
  }
}
