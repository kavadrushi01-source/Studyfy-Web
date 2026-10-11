import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import { initiateSubscriptionPayment, verifySubscriptionPayment } from "./billing.service.js";
import { payVerifySchema } from "./billing.schemas.js";
import { PLANS, effectivePlan } from "./plans.js";

export const billingRouter = Router();

function sendBillingError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// GET /schools/:schoolId/billing/overview — the billing page's data: mirror
// fields, subscription row (nullable pre-billing), latest invoices, the
// plan catalog (SAME object the pricing cards render from — §16.1), and the
// effective tier. This is the ONE tenant route a suspended School Admin can
// still reach (§13.4 exception, enforced in tenantMiddleware); billing.read
// is an admin-only key, so teachers/pupils/parents 403 here regardless.
billingRouter.get(
  "/schools/:schoolId/billing/overview",
  authMiddleware,
  tenantMiddleware,
  requirePermission("billing.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    // NOTE: explicit `where: { id }` — School is the tenant ROOT and has no
    // schoolId column, so it is deliberately NOT in TENANT_MODELS and the
    // extension never pins it. Every other school read in src/ passes an
    // explicit id/slug for exactly this reason; a bare findFirst here once
    // returned another school's row (caught by test, never shipped).
    const school = await req.prisma.school.findFirst({
      where: { id: req.schoolId ?? "" },
      select: { id: true, name: true, subscriptionStatus: true, plan: true, trialEndsAt: true, state: true },
    });
    if (!school) {
      res.status(404).json({
        success: false,
        data: null,
        error: { code: "SCHOOL_NOT_FOUND", message: "School not found." },
        meta: null,
      });
      return;
    }
    const subscription = await req.prisma.subscription.findFirst({});
    const invoices = await req.prisma.subscriptionInvoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    res.json({
      success: true,
      data: {
        school,
        subscription,
        invoices,
        plans: PLANS,
        effectivePlan: effectivePlan(school.subscriptionStatus, school.plan),
      },
      error: null,
      meta: null,
    });
  }),
);

// POST /schools/:schoolId/billing/invoices/:invoiceId/pay-order — the
// school pays Studyfy online (TEST MODE, §1/§16.1). SCHOOL ADMIN ONLY (like
// device enrollment: the permission grants the area, the role check grants
// the action). Frontend sends ONLY the invoice id — the server recomputes
// the total (amount + GST) and creates the Razorpay order for that number.
billingRouter.post(
  "/schools/:schoolId/billing/invoices/:invoiceId/pay-order",
  authMiddleware,
  tenantMiddleware,
  requirePermission("billing.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    if (req.user.role !== "SCHOOL_ADMIN") {
      sendBillingError(res, new AuthError(403, "FORBIDDEN", "Only a School Admin may pay subscription invoices."));
      return;
    }
    try {
      const result = await initiateSubscriptionPayment(req.prisma, req.params.invoiceId ?? "");
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendBillingError(res, err);
    }
  }),
);

// POST /schools/:schoolId/billing/pay-verify — reconcile a pending
// subscription order against what Razorpay holds (same fallback shape as
// fee pay-verify, §13.8). Admin only.
billingRouter.post(
  "/schools/:schoolId/billing/pay-verify",
  authMiddleware,
  tenantMiddleware,
  requirePermission("billing.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma || !req.user) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    if (req.user.role !== "SCHOOL_ADMIN") {
      sendBillingError(res, new AuthError(403, "FORBIDDEN", "Only a School Admin may verify subscription payments."));
      return;
    }
    const parsed = payVerifySchema.safeParse(req.body);
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
      const result = await verifySubscriptionPayment(
        req.prisma,
        req.schoolId ?? "",
        req.user.userId,
        parsed.data.orderId,
      );
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendBillingError(res, err);
    }
  }),
);
