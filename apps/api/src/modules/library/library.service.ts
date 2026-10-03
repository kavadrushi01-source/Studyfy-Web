import { Prisma, type PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import type { CreateBookInput, IssueBookInput, ListBooksInput, ListLoansInput, UpdateBookInput } from "./library.schemas.js";

export const DEFAULT_FINE_PER_DAY = 5;
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

// School-local calendar day (§12.7): "2026-10-03" in the school's own
// timezone, immune to DST (a 23-hour day still changes the date once).
function schoolDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Whole-day overdue math on SCHOOL calendar days (§12.7): any part of a
// day past the due date counts as a day (due Monday, back Tuesday = one
// day), and UTC midnight never decides it — a book due 23:30 UTC is due
// 05:00 IST the next morning, and only IST dates count. Never negative.
export function overdueDays(dueAt: Date, end: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const start = Date.parse(`${schoolDay(dueAt, timeZone)}T00:00:00Z`);
  const finish = Date.parse(`${schoolDay(end, timeZone)}T00:00:00Z`);
  return Math.max(0, Math.round((finish - start) / 86400000));
}

export function fineRupees(dueAt: Date, end: Date, ratePerDay: number, timeZone: string = DEFAULT_TIMEZONE): number {
  return overdueDays(dueAt, end, timeZone) * ratePerDay;
}

export async function getLibrarySettings(db: PrismaClient, schoolId: string): Promise<{ finePerDay: number }> {
  const school = await db.school.findFirst({ where: { id: schoolId }, select: { libraryFinePerDay: true } });
  if (!school) {
    throw new AuthError(404, "SCHOOL_NOT_FOUND", "School not found.");
  }
  return { finePerDay: school.libraryFinePerDay };
}

export async function updateLibrarySettings(
  db: PrismaClient,
  schoolId: string,
  finePerDay: number,
): Promise<{ finePerDay: number }> {
  const school = await db.school.findFirst({ where: { id: schoolId }, select: { id: true } });
  if (!school) {
    throw new AuthError(404, "SCHOOL_NOT_FOUND", "School not found.");
  }
  await db.school.update({ where: { id: school.id }, data: { libraryFinePerDay: finePerDay } });
  return { finePerDay };
}

// Library (§7 Phase 2 #13): catalog + issue/return. Copies move through
// availableCopies transactionally (issue decrements, return increments —
// never below zero, never above total). Overdue is DERIVED (past due,
// not returned), never stored, so it cannot rot. Staff with
// library.manage run the desk; pupils/parents with library.read see the
// catalog plus their own/linked loans via studentScope pins. Cross-tenant
// safety from tenantMiddleware + TENANT_MODELS, proven by the
// stranger-school test in the suite.
export async function listBooks(db: PrismaClient, input: ListBooksInput) {
  const where: Record<string, unknown> = {};
  if (input.search) {
    const q = input.search;
    where.OR = [{ title: { contains: q } }, { author: { contains: q } }, { isbn: { contains: q } }];
  }
  if (input.category) {
    where.category = input.category;
  }
  if (input.available === "true") {
    where.availableCopies = { gt: 0 };
  } else if (input.available === "false") {
    where.availableCopies = 0;
  }
  const [total, rows, categories] = await Promise.all([
    db.book.count({ where }),
    db.book.findMany({
      where,
      select: {
        id: true,
        title: true,
        author: true,
        isbn: true,
        category: true,
        totalCopies: true,
        availableCopies: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ title: "asc" }, { author: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.book.groupBy({ by: ["category"], _count: { category: true } }),
  ]);
  return {
    books: rows,
    categories: categories.map((c) => c.category).sort(),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export async function createBook(db: PrismaClient, callerUserId: string, input: CreateBookInput) {
  const caller = await db.user.findUnique({ where: { id: callerUserId }, select: { schoolId: true } });
  if (!caller?.schoolId) {
    throw new AuthError(401, "UNAUTHENTICATED", "Authentication required.");
  }
  const book = await db.book.create({
    data: {
      schoolId: caller.schoolId,
      title: input.title,
      author: input.author,
      isbn: input.isbn ?? null,
      category: input.category,
      totalCopies: input.totalCopies,
      availableCopies: input.totalCopies,
    },
  });
  return { book };
}

export async function updateBook(db: PrismaClient, bookId: string, input: UpdateBookInput) {
  const book = await db.book.findFirst({ where: { id: bookId }, select: { id: true, totalCopies: true, availableCopies: true } });
  if (!book) {
    throw new AuthError(404, "BOOK_NOT_FOUND", "Book not found in this school.");
  }
  // Shrinking the shelf below what's already out would corrupt the count.
  if (input.totalCopies !== undefined) {
    const issued = book.totalCopies - book.availableCopies;
    if (input.totalCopies < issued) {
      throw new AuthError(409, "COPIES_ISSUED", `Cannot shrink below the ${issued} cop${issued === 1 ? "y" : "ies"} currently issued.`);
    }
    const delta = input.totalCopies - book.totalCopies;
    await db.book.update({
      where: { id: book.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.author !== undefined ? { author: input.author } : {}),
        ...(input.isbn !== undefined ? { isbn: input.isbn } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        totalCopies: input.totalCopies,
        availableCopies: book.availableCopies + delta,
      },
    });
  } else {
    await db.book.update({
      where: { id: book.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.author !== undefined ? { author: input.author } : {}),
        ...(input.isbn !== undefined ? { isbn: input.isbn } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
      },
    });
  }
  const updated = await db.book.findFirstOrThrow({ where: { id: book.id } });
  return { book: updated };
}

export async function deleteBook(db: PrismaClient, bookId: string) {
  const book = await db.book.findFirst({ where: { id: bookId }, select: { id: true, title: true } });
  if (!book) {
    throw new AuthError(404, "BOOK_NOT_FOUND", "Book not found in this school.");
  }
  const active = await db.bookLoan.count({ where: { bookId: book.id, returnedAt: null } });
  if (active > 0) {
    throw new AuthError(409, "LOANS_ACTIVE", "Cannot remove a book with copies still issued.");
  }
  // History goes with the title (restrict would strand the shelf):
  // the loan log is desk paperwork, the catalog is the source of truth.
  await db.$transaction([
    db.bookLoan.deleteMany({ where: { bookId: book.id } }),
    db.book.delete({ where: { id: book.id } }),
  ]);
  return { deleted: book.id, title: book.title };
}

export async function issueBook(
  db: PrismaClient,
  callerUserId: string,
  bookId: string,
  input: IssueBookInput,
) {
  const [book, student] = await Promise.all([
    db.book.findFirst({ where: { id: bookId } }),
    db.student.findFirst({
      where: { id: input.studentId },
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);
  if (!book) {
    throw new AuthError(404, "BOOK_NOT_FOUND", "Book not found in this school.");
  }
  if (!student) {
    throw new AuthError(404, "STUDENT_NOT_FOUND", "Student not found in this school.");
  }
  if (book.availableCopies <= 0) {
    throw new AuthError(409, "NO_COPIES_AVAILABLE", `All ${book.totalCopies} cop${book.totalCopies === 1 ? "y" : "ies"} of "${book.title}" are currently issued.`);
  }
  const dueAt = new Date(Date.now() + input.dueDays * 86400000);
  const [loan] = await db.$transaction([
    db.bookLoan.create({
      data: {
        schoolId: book.schoolId,
        bookId: book.id,
        studentId: student.id,
        issuedBy: callerUserId,
        dueAt,
      },
      select: {
        id: true,
        issuedAt: true,
        dueAt: true,
        book: { select: { id: true, title: true } },
        student: { select: { id: true, user: { select: { name: true } } } },
      },
    }),
    db.book.update({ where: { id: book.id }, data: { availableCopies: { decrement: 1 } } }),
  ]);
  return { loan };
}

export async function returnBook(db: PrismaClient, loanId: string) {
  const loan = await db.bookLoan.findFirst({
    where: { id: loanId },
    select: { id: true, bookId: true, schoolId: true, dueAt: true, returnedAt: true },
  });
  if (!loan) {
    throw new AuthError(404, "LOAN_NOT_FOUND", "Loan not found in this school.");
  }
  if (loan.returnedAt) {
    throw new AuthError(409, "ALREADY_RETURNED", "This loan was already returned.");
  }
  // The fine freezes at return time (days overdue × the school's rate then
  // in force) — later rate changes never rewrite history.
  const now = new Date();
  const school = await db.school.findFirst({ where: { id: loan.schoolId }, select: { libraryFinePerDay: true, timezone: true } });
  const fine = fineRupees(loan.dueAt, now, school?.libraryFinePerDay ?? DEFAULT_FINE_PER_DAY, school?.timezone ?? DEFAULT_TIMEZONE);
  const [updated] = await db.$transaction([
    db.bookLoan.update({
      where: { id: loan.id },
      data: { returnedAt: now, fineAmount: new Prisma.Decimal(fine) },
      select: {
        id: true,
        issuedAt: true,
        dueAt: true,
        returnedAt: true,
        fineAmount: true,
        book: { select: { id: true, title: true } },
        student: { select: { id: true, user: { select: { name: true } } } },
      },
    }),
    db.book.update({ where: { id: loan.bookId }, data: { availableCopies: { increment: 1 } } }),
  ]);
  return {
    loan: {
      ...updated,
      fineAmount: updated.fineAmount === null ? null : updated.fineAmount.toFixed(2),
    },
  };
}

export interface LoanRow {
  id: string;
  status: "ISSUED" | "RETURNED" | "OVERDUE";
  issuedAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  // Rupees owed, two decimals: the frozen record for returned loans, a
  // live computation (today × current rate) for open ones.
  fine: string;
  book: { id: string; title: string; author: string };
  student: { id: string; name: string };
  issuer: { name: string };
}

export async function listLoans(
  db: PrismaClient,
  schoolId: string,
  input: ListLoansInput,
  allowedIds: string[] | null,
): Promise<{
  loans: LoanRow[];
  finePerDay: number;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}> {
  const where: Record<string, unknown> = {};
  if (allowedIds) {
    where.studentId = { in: allowedIds };
  }
  if (input.studentId) {
    if (allowedIds && !allowedIds.includes(input.studentId)) {
      throw new AuthError(403, "FORBIDDEN", "Not your record.");
    }
    where.studentId = input.studentId;
  }
  if (input.status === "RETURNED") {
    where.returnedAt = { not: null };
  } else if (input.status === "ISSUED") {
    where.returnedAt = null;
  } else if (input.status === "OVERDUE") {
    // Calendar math can't run in SQL: pull the open set (bounded — a
    // school's open loans number in the hundreds) and narrow in code so
    // the filter and the displayed status can never disagree.
    where.returnedAt = null;
  }
  const selection = {
    id: true,
    issuedAt: true,
    dueAt: true,
    returnedAt: true,
    fineAmount: true,
    book: { select: { id: true, title: true, author: true } },
    student: { select: { id: true, user: { select: { name: true } } } },
    issuer: { select: { name: true } },
  } as const;
  const ordering = { issuedAt: "desc" } as const;
  const [total, rows, school] = await Promise.all([
    input.status === "OVERDUE" ? 0 : db.bookLoan.count({ where }),
    input.status === "OVERDUE"
      ? db.bookLoan.findMany({ where, select: selection, orderBy: ordering, take: 2000 })
      : db.bookLoan.findMany({
        where,
        select: selection,
        orderBy: ordering,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    db.school.findFirst({ where: { id: schoolId }, select: { libraryFinePerDay: true, timezone: true } }),
  ]);
  const now = new Date();
  const rate = school?.libraryFinePerDay ?? DEFAULT_FINE_PER_DAY;
  const timeZone = school?.timezone ?? DEFAULT_TIMEZONE;
  const shaped = rows.map((r) => {
    const daysLate = overdueDays(r.dueAt, r.returnedAt ?? now, timeZone);
    return {
      id: r.id,
      status: (r.returnedAt ? "RETURNED" : daysLate > 0 ? "OVERDUE" : "ISSUED") as LoanRow["status"],
      issuedAt: r.issuedAt,
      dueAt: r.dueAt,
      returnedAt: r.returnedAt,
      fine: (r.returnedAt ? Number(r.fineAmount ?? 0) : fineRupees(r.dueAt, now, rate, timeZone)).toFixed(2),
      book: r.book,
      student: { id: r.student.id, name: r.student.user.name },
      issuer: { name: r.issuer.name },
    };
  });
  const visible = input.status === "OVERDUE" ? shaped.filter((r) => r.status === "OVERDUE") : shaped;
  const paged =
    input.status === "OVERDUE"
      ? visible.slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
      : visible;
  const fullTotal = input.status === "OVERDUE" ? visible.length : total;
  return {
    loans: paged,
    finePerDay: rate,
    page: input.page,
    pageSize: input.pageSize,
    total: fullTotal,
    totalPages: Math.max(1, Math.ceil(fullTotal / input.pageSize)),
  };
}
