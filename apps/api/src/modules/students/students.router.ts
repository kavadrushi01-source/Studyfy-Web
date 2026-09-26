import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { catchAsync } from "../../lib/async.js";
import { generateStudentIdCard } from "../../lib/id-card.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { teacherSectionScope } from "../../middleware/teacher-scope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { admitStudentSchema, listStudentsSchema } from "./students.schemas.js";
import { admitStudent } from "./students.service.js";

function sendStudentError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({
      success: false,
      data: null,
      error: { code: "EMAIL_TAKEN", message: "An account with this email already exists in this school." },
      meta: null,
    });
    return;
  }
  throw err;
}

export const studentsRouter = Router();

// Chain per route: auth -> tenant -> permission -> self-scope. The permission
// grants ACCESS (table-driven); self-scope narrows ROWS for STUDENT/PARENT.
// Admission (POST) skips self-scope: an admin creates OTHER people's rows.
studentsRouter.post(
  "/schools/:schoolId/students",
  authMiddleware,
  tenantMiddleware,
  requirePermission("students.write"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const parsed = admitStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        meta: null,
      });
      return;
    }
    try {
      const result = await admitStudent(req.prisma, parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendStudentError(res, err);
    }
  }),
);

studentsRouter.get(
  "/schools/:schoolId/students",
  authMiddleware,
  tenantMiddleware,
  requirePermission("students.read"),
  studentSelfScope,
  teacherSectionScope,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const parsed = listStudentsSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid query." },
        meta: null,
      });
      return;
    }
    const { page, pageSize, sort, order, search, sectionId } = parsed.data;

    const filters: Prisma.StudentWhereInput[] = [];
    if (req.studentScope) {
      filters.push({ id: { in: req.studentScope.studentIds } });
    }
    if (req.sectionScope) {
      filters.push({ sectionId: { in: req.sectionScope } });
    }
    if (sectionId) {
      filters.push({ sectionId });
    }
    if (search) {
      filters.push({
        OR: [
          { user: { name: { contains: search } } },
          { user: { email: { contains: search } } },
          { admissionNo: { contains: search } },
        ],
      });
    }
    const where: Prisma.StudentWhereInput = filters.length > 0 ? { AND: filters } : {};

    const orderBy: Prisma.StudentOrderByWithRelationInput =
      sort === "name"
        ? { user: { name: order } }
        : sort === "email"
          ? { user: { email: order } }
          : { [sort]: order };

    const [total, students] = await Promise.all([
      req.prisma.student.count({ where }),
      req.prisma.student.findMany({
        where,
        select: {
          id: true,
          admissionNo: true,
          rollNumber: true,
          gender: true,
          user: { select: { name: true, email: true } },
          section: { select: { id: true, name: true, class: { select: { name: true } } } },
        },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({
      success: true,
      data: { students },
      error: null,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  }),
);

studentsRouter.get(
  "/schools/:schoolId/students/:studentId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("students.read"),
  studentSelfScope,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const student = await req.prisma.student.findFirst({
      where: { id: req.params.studentId },
      select: {
        id: true,
        sectionId: true,
        admissionNo: true,
        rollNumber: true,
        dob: true,
        gender: true,
        user: { select: { name: true, email: true } },
        // The print page (and its ID-card card) render class + section from
        // the detail payload — omitting `section` crashed the page at
        // profile.section.class (found by the human-check e2e).
        section: { select: { id: true, name: true, class: { select: { name: true } } } },
        guardianLinks: {
          select: { relationship: true, parent: { select: { name: true, email: true } } },
        },
      },
    });
    if (!student) {
      res.status(404).json({
        success: false,
        data: null,
        error: { code: "NOT_FOUND", message: "Student not found." },
        meta: null,
      });
      return;
    }
    res.json({ success: true, data: { student }, error: null, meta: null });
  }),
);

// ID card PDF (SIS). Same chain as the detail route — self-scope decides
// WHO may render it (own / linked / staff), the PDF just draws what the
// detail endpoint would return. Streams application/pdf inline.
studentsRouter.get(
  "/schools/:schoolId/students/:studentId/id-card",
  authMiddleware,
  tenantMiddleware,
  requirePermission("students.read"),
  studentSelfScope,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.schoolId) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const [student, school] = await Promise.all([
      req.prisma.student.findFirst({
        where: { id: req.params.studentId },
        select: {
          admissionNo: true,
          dob: true,
          user: { select: { name: true } },
          section: { select: { name: true, class: { select: { name: true } } } },
        },
      }),
      req.prisma.school.findFirst({ where: { id: req.schoolId } }),
    ]);
    if (!student || !school) {
      res.status(404).json({
        success: false,
        data: null,
        error: { code: "NOT_FOUND", message: "Student not found." },
        meta: null,
      });
      return;
    }
    const pdf = await generateStudentIdCard({
      schoolName: school.name,
      brandColor: school.brandColor ?? "#2563EB",
      studentName: student.user.name,
      admissionNo: student.admissionNo,
      className: student.section.class.name,
      sectionName: student.section.name,
      dob: student.dob,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="id-card-${req.params.studentId}.pdf"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.send(pdf);
  }),
);
