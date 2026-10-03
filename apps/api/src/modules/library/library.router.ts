import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import {
  createBookSchema,
  issueBookSchema,
  listBooksSchema,
  listLoansSchema,
  updateBookSchema,
  updateSettingsSchema,
} from "./library.schemas.js";
import { createBook, deleteBook, getLibrarySettings, issueBook, listBooks, listLoans, returnBook, updateBook, updateLibrarySettings } from "./library.service.js";

export const libraryRouter = Router();

function sendLibraryError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({
    success: false,
    data: null,
    error: { code: "VALIDATION_ERROR", message },
    meta: null,
  });
}

function internalError(res: Response): void {
  res.status(500).json({
    success: false,
    data: null,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    meta: null,
  });
}

// Catalog (every school role with library.read): searchable, filterable,
// paginated, A–Z.
libraryRouter.get(
  "/schools/:schoolId/library/books",
  authMiddleware,
  tenantMiddleware,
  requirePermission("library.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = listBooksSchema.safeParse(req.query);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid query.");
      return;
    }
    try {
      const result = await listBooks(req.prisma, parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendLibraryError(res, err);
    }
  }),
);

// Add a title (library.manage): copies start fully available.
libraryRouter.post(
  "/schools/:schoolId/library/books",
  authMiddleware,
  tenantMiddleware,
  requirePermission("library.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      internalError(res);
      return;
    }
    const parsed = createBookSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await createBook(req.prisma, req.user.userId, parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendLibraryError(res, err);
    }
  }),
);

// Edit a title (library.manage): shrinking below issued copies is refused.
libraryRouter.patch(
  "/schools/:schoolId/library/books/:bookId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("library.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = updateBookSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await updateBook(req.prisma, req.params.bookId ?? "", parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendLibraryError(res, err);
    }
  }),
);

// Remove a title (library.manage): refused while copies are out; history
// goes with the title.
libraryRouter.delete(
  "/schools/:schoolId/library/books/:bookId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("library.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await deleteBook(req.prisma, req.params.bookId ?? "");
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendLibraryError(res, err);
    }
  }),
);

// Issue a copy (library.manage): pupil + due length; empty shelf is 409.
libraryRouter.post(
  "/schools/:schoolId/library/books/:bookId/issue",
  authMiddleware,
  tenantMiddleware,
  requirePermission("library.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      internalError(res);
      return;
    }
    const parsed = issueBookSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await issueBook(req.prisma, req.user.userId, req.params.bookId ?? "", parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendLibraryError(res, err);
    }
  }),
);

// Take a return (library.manage): double returns are 409.
libraryRouter.post(
  "/schools/:schoolId/library/loans/:loanId/return",
  authMiddleware,
  tenantMiddleware,
  requirePermission("library.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await returnBook(req.prisma, req.params.loanId ?? "");
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendLibraryError(res, err);
    }
  }),
);

// Fine policy (library.manage to change, library.read to see): flat
// rupees per overdue day for the whole school. Returns also carry it so
// the desk always prices with the current rate.
libraryRouter.get(
  "/schools/:schoolId/library/settings",
  authMiddleware,
  tenantMiddleware,
  requirePermission("library.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await getLibrarySettings(req.prisma, req.params.schoolId ?? "");
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendLibraryError(res, err);
    }
  }),
);

libraryRouter.patch(
  "/schools/:schoolId/library/settings",
  authMiddleware,
  tenantMiddleware,
  requirePermission("library.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await updateLibrarySettings(req.prisma, req.params.schoolId ?? "", parsed.data.finePerDay);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendLibraryError(res, err);
    }
  }),
);

// Loans (library.read): staff see everything (filterable by stage/pupil);
// STUDENT/PARENT are pinned to own/linked rows, same §3 contract as fees.
libraryRouter.get(
  "/schools/:schoolId/library/loans",
  authMiddleware,
  tenantMiddleware,
  requirePermission("library.read"),
  studentSelfScope,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = listLoansSchema.safeParse(req.query);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid query.");
      return;
    }
    try {
      const result = await listLoans(
        req.prisma,
        req.params.schoolId ?? "",
        parsed.data,
        req.studentScope ? req.studentScope.studentIds : null,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendLibraryError(res, err);
    }
  }),
);
