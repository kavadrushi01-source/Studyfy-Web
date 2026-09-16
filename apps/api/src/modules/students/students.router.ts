import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { tenantMiddleware } from "../../middleware/tenant.js";

export const studentsRouter = Router();

// Minimal probe today (full SIS roster is a Phase 1 module). What matters:
// authMiddleware -> tenantMiddleware -> handler uses ONLY req.prisma, so the
// schoolId filter is structurally enforced, not per-route discipline.
studentsRouter.get(
  "/schools/:schoolId/students",
  authMiddleware,
  tenantMiddleware,
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
    const students = await req.prisma.student.findMany({
      select: { id: true },
      take: 100,
    });
    res.json({ success: true, data: { students }, error: null, meta: null });
  }),
);
