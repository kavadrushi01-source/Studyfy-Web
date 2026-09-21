// Studyfy seed — roles (global, once) + two demo schools (DEMO_DATA.md).
// Idempotent: every row is upserted / find-first-skipped on a unique key,
// so re-running never duplicates and screenshots stay consistent run to run.
// All transactional values are DETERMINISTIC (index-derived, no randomness)
// for the same reason — DEMO_DATA.md demands reusable demos, not variety.
//
// Passwords: EVERY seeded account uses the shared demo password below.
// This is deliberately NOT §13.3's random-password flow — that rule protects
// REAL schools' REAL accounts; seed data exists so a human can log in as
// each role and verify by hand. Never reuse this pattern for real imports.
//
// Run: npm run db:seed  (repo root; DATABASE_URL from env). Local/dev only.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const ROLES: { name: string; description: string }[] = [
  { name: "PLATFORM_OWNER", description: "Cross-tenant platform owner (no school_id)" },
  { name: "SCHOOL_ADMIN", description: "Full configuration within one school" },
  { name: "TEACHER", description: "Assigned classes/sections only" },
  { name: "ACCOUNTANT", description: "Fee collection and financial reports" },
  { name: "STUDENT", description: "Own records only (row-level self-scope)" },
  { name: "PARENT", description: "Linked children's records only (row-level self-scope)" },
  { name: "LIBRARIAN", description: "Library module (Phase 2)" },
  { name: "TRANSPORT_MANAGER", description: "Transport module (Phase 2)" },
];

export async function seedRoles(db: PrismaClient): Promise<string[]> {
  const names: string[] = [];
  for (const role of ROLES) {
    const row = await db.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
    names.push(row.name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Permissions — the OTHER half of RBAC (RULES.md §6). Like roles: global,
// seeded once, never per-school. Each Phase 1 module adds its keys in the
// SAME commit that first enforces them; this box seeds only what the
// current routes check (students.read, platform.schools.read).
// ---------------------------------------------------------------------------

const PERMISSIONS: { key: string; description: string }[] = [
  { key: "students.read", description: "List and read student records (row-narrowed by self-scope for STUDENT/PARENT)" },
  { key: "students.write", description: "Admit and edit students (School Admin, Accountant)" },
  { key: "sections.read", description: "List classes/sections and assignments" },
  { key: "sections.write", description: "Assign class teachers to sections (School Admin)" },
  { key: "attendance.mark", description: "Mark attendance (class teacher of the section, School Admin)" },
  { key: "attendance.read", description: "Read attendance summaries (row-narrowed by self-scope for STUDENT/PARENT)" },
  { key: "notices.read", description: "Read notices (students/parents see school-wide + own class/section only)" },
  { key: "notices.write", description: "Publish notices (School Admin, Teacher)" },
  { key: "fees.manage", description: "Create fee structures, record payments (School Admin, Accountant)" },
  { key: "fees.read", description: "Read invoices and ledgers (staff; students/parents narrowed to own)" },
  { key: "exams.manage", description: "Create exams and link subjects (School Admin, Teacher)" },
  { key: "exams.read", description: "Read exam schedules (all school roles)" },
  { key: "staff.manage", description: "Manage staff setup incl. teacher qualifications (School Admin)" },
  { key: "documents.read", description: "Read uploaded documents (staff; students/parents narrowed to own)" },
  { key: "documents.write", description: "Upload admission documents (School Admin, Accountant)" },
  { key: "platform.schools.read", description: "List every school cross-tenant (Platform Owner only)" },
];

// Role -> permission keys. STUDENT/PARENT hold students.read because the
// PERMISSION grants access while self-scope narrows ROWS — holding the key
// never means seeing everyone.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  SCHOOL_ADMIN: ["students.read", "students.write", "sections.read", "sections.write", "attendance.mark", "attendance.read", "notices.read", "notices.write", "fees.manage", "fees.read", "exams.manage", "exams.read", "staff.manage", "documents.read", "documents.write"],
  TEACHER: ["students.read", "sections.read", "attendance.mark", "attendance.read", "notices.read", "notices.write", "exams.manage", "exams.read", "documents.read"],
  ACCOUNTANT: ["students.read", "students.write", "sections.read", "attendance.read", "notices.read", "fees.manage", "fees.read", "exams.read", "documents.read", "documents.write"],
  STUDENT: ["students.read", "documents.read", "attendance.read", "notices.read", "fees.read", "exams.read"],
  PARENT: ["students.read", "documents.read", "attendance.read", "notices.read", "fees.read", "exams.read"],
  PLATFORM_OWNER: ["platform.schools.read"],
};

export async function seedPermissions(db: PrismaClient): Promise<void> {
  for (const permission of PERMISSIONS) {
    await db.permission.upsert({
      where: { key: permission.key },
      update: { description: permission.description },
      create: permission,
    });
  }
  for (const [roleName, keys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await db.role.findUnique({ where: { name: roleName } });
    if (!role) {
      throw new Error(`Role ${roleName} must be seeded before permissions.`);
    }
    for (const key of keys) {
      const permission = await db.permission.findUnique({ where: { key } });
      if (!permission) {
        throw new Error(`Permission ${key} must be seeded before mappings.`);
      }
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Demo data (DEMO_DATA.md — exact names, do not invent different ones)
// ---------------------------------------------------------------------------

const DEMO_PASSWORD = "Demo@1234";
// Cost 10: the RULES.md minimum. One hash is computed and REUSED for every
// seeded account (same password → same string is fine here), keeping the
// seed fast. Real imports must use random per-account passwords (§13.3).
const DEMO_BCRYPT_COST = 10;

const OWNER_EMAIL = "owner@studyfy.dev";

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

interface DemoSchool {
  name: string;
  slug: string;
  city: string;
  state: string;
  brandColor: string;
  emailDomain: string;
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

const SCHOOLS: DemoSchool[] = [
  {
    name: "School of Science",
    slug: "school-of-science",
    city: "Ahmedabad",
    state: "Gujarat",
    brandColor: "#0D9488",
    emailDomain: "schoolofscience.demo",
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

async function seedOwner(db: PrismaClient, passwordHash: string): Promise<void> {
  const role = await db.role.findUnique({ where: { name: "PLATFORM_OWNER" } });
  if (!role) {
    throw new Error("PLATFORM_OWNER role must be seeded before the owner account.");
  }
  // No upsert possible: the unique key (schoolId, email) contains NULL.
  // findFirst + create is the §13.4-sanctioned path (seed-only creation).
  const existing = await db.user.findFirst({ where: { schoolId: null, email: OWNER_EMAIL } });
  if (!existing) {
    await db.user.create({
      data: { schoolId: null, roleId: role.id, email: OWNER_EMAIL, passwordHash, name: "Admin User" },
    });
  }
}

async function seedSchool(db: PrismaClient, spec: DemoSchool, roles: Map<string, string>, passwordHash: string): Promise<void> {
  const required = ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STUDENT", "PARENT"] as const;
  for (const name of required) {
    if (!roles.get(name)) {
      throw new Error(`Role ${name} must be seeded before demo schools.`);
    }
  }

  // ACTIVE, never TRIAL: a "trial ending" countdown would be a wrong
  // impression in a walkthrough (DEMO_DATA.md). trialEndsAt still required
  // by the schema — set a year out, inert while ACTIVE.
  const school = await db.school.upsert({
    where: { slug: spec.slug },
    update: {
      name: spec.name,
      city: spec.city,
      state: spec.state,
      timezone: "Asia/Kolkata",
      subscriptionStatus: "ACTIVE",
      brandColor: spec.brandColor,
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
    },
  });

  for (const subject of SUBJECTS) {
    await db.subject.upsert({
      where: { schoolId_name: { schoolId: school.id, name: subject.name } },
      update: { group: subject.group },
      create: { schoolId: school.id, name: subject.name, group: subject.group },
    });
  }

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
      update: { sectionId },
      create: { schoolId: school.id, userId, sectionId },
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
  const marker = teacherStaffIds[0];
  if (marker) {
    await seedAttendance(db, school.id, seeded, marker);
  }
  const mathTeacher = teacherStaffIds[0];
  if (mathTeacher) {
    await seedHomework(db, school.id, sectionIds, mathTeacher, seeded);
  }
  await seedNotices(db, school.id, classIds, adminId, spec.eventNotice);
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

export async function seedDemo(db: PrismaClient): Promise<void> {
  const roles = new Map<string, string>();
  for (const name of ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STUDENT", "PARENT"] as const) {
    const role = await db.role.findUnique({ where: { name } });
    if (role) {
      roles.set(name, role.id);
    }
  }
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, DEMO_BCRYPT_COST);
  await seedOwner(db, passwordHash);
  for (const spec of SCHOOLS) {
    await seedSchool(db, spec, roles, passwordHash);
  }
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("prisma/seed.ts");

if (invokedDirectly) {
  // No top-level await: this file must also run as CJS (repo root has no
  // "type": "module", so tsx compiles it to CJS).
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const names = await seedRoles(db);
    console.log(`Seeded roles: ${names.join(", ")}`);
    await seedPermissions(db);
    console.log(`Seeded permissions: ${PERMISSIONS.map((p) => p.key).join(", ")}`);
    await seedDemo(db);
    console.log(`Seeded demo schools: ${SCHOOLS.map((s) => s.slug).join(", ")} + owner ${OWNER_EMAIL}`);
    console.log(`Demo password for every account: ${DEMO_PASSWORD}`);
  } finally {
    await db.$disconnect();
  }
}
