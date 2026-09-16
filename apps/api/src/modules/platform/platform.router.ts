import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { platformOnlyMiddleware } from "../../middleware/platform-only.js";

export const platformRouter = Router();

// Every route here: authMiddleware + platformOnlyMiddleware — NEVER
// tenantMiddleware (spec §13.4). Full billing/analytics UI is Phase 4;
// this lists what Phase 1 already knows: schools + live counts.
platformRouter.get(
  "/schools",
  authMiddleware,
  platformOnlyMiddleware,
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
    const schools = await req.prisma.school.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        createdAt: true,
        _count: { select: { users: true, students: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ success: true, data: { schools }, error: null, meta: null });
  }),
);
