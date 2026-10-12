import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { platformOnlyMiddleware } from "../../middleware/platform-only.js";
import { requirePermission } from "../../middleware/rbac.js";
import { AuthError } from "../auth/auth.service.js";
import { listPlatformAuditSchema } from "../audit/audit.schemas.js";
import { listAuditLogs } from "../audit/audit.service.js";
import { recordAudit } from "../../lib/audit.js";
import { markInvoicePaid, issueInvoice, setSubscription } from "../billing/billing.service.js";
import {
  billingPlanSchema,
  issueSubscriptionInvoiceSchema,
  reactivateSchoolSchema,
  subscriptionInvoiceListSchema,
  suspendSchoolSchema,
  trialExtensionSchema,
} from "../billing/billing.schemas.js";
import { getOwnerDashboard } from "../metrics/metrics.service.js";

export const platformRouter = Router();

// Every route here: authMiddleware + platformOnlyMiddleware — NEVER
// tenantMiddleware (spec §13.4). requirePermission on top: the gate checks
// the tenant MODEL (NULL school_id), the table grants the FEATURE.
platformRouter.get(
  "/schools",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.schools.read"),
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
        plan: true,
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

// Platform Owner board (§7 Phase 1 #9, §8.3 + sequencing note): live
// school counts, schools table data, real signups-per-month analytics.
// Revenue and plan mix are honest zeros/empties until Phase 4 billing
// exists — never projections. Same middleware as every route here:
// platform-only, never tenant-scoped.
platformRouter.get(
  "/dashboard",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.schools.read"),
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
    try {
      const dashboard = await getOwnerDashboard(req.prisma);
      res.json({ success: true, data: { dashboard }, error: null, meta: null });
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
        return;
      }
      throw err;
    }
  }),
);

// Platform-wide audit reads (§13.10): the Owner sees every school's rows
// AND the platform-level NULL rows (owner logins live there) — the raw
// client applies no tenant pin. Same cursor pagination + filters as the
// school route, via the shared reader, plus an optional ?schoolId=.
// Same middleware as every route here: platform-only, never tenant-scoped.
platformRouter.get(
  "/audit-logs",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.audit.read"),
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
    const parsed = listPlatformAuditSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid query." },
        meta: null,
      });
      return;
    }
    const { logs, nextCursor } = await listAuditLogs(req.prisma, parsed.data);
    res.json({ success: true, data: { logs, nextCursor }, error: null, meta: null });
  }),
);

// ---------------------------------------------------------------------------
// Billing administration (§16.1, Chunk 2): suspend / reactivate / plan /
// trial / invoices / mark-paid. Owner-only, audited. Demo schools are
// IMMUNE to suspension — the portfolio demo stays up no matter what, and a
// billing action pointed at one fails loudly instead of locking it.
// ---------------------------------------------------------------------------

function sendBillingError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// POST /platform/schools/:id/suspend — blocks every tenant login except a
// suspended School Admin's billing/support/logout paths (§13.4). Data is
// retained, never deleted (§16 auto-downgrade, not delete).
platformRouter.post(
  "/schools/:id/suspend",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.billing.manage"),
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
    const parsed = suspendSchoolSchema.safeParse(req.body ?? {});
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
      const school = await req.prisma.school.findUnique({ where: { id: req.params.id } });
      if (!school) {
        sendBillingError(res, new AuthError(404, "SCHOOL_NOT_FOUND", "School not found."));
        return;
      }
      if (school.isDemo) {
        sendBillingError(res, new AuthError(403, "FORBIDDEN", "Demo schools cannot be suspended."));
        return;
      }
      const result = await setSubscription(
        req.prisma,
        school.id,
        { plan: school.plan ?? "BASIC", status: "SUSPENDED" },
        req.user.userId,
        "SUBSCRIPTION_STATUS_CHANGE",
      );
      res.json({ success: true, data: { subscription: result, reason: parsed.data.reason ?? null }, error: null, meta: null });
    } catch (err) {
      sendBillingError(res, err);
    }
  }),
);

// POST /platform/schools/:id/reactivate — exceptional manual path (the
// normal path is mark-paid, which re-activates automatically). Requires an
// explicit paid period — reactivation without one would invent free access.
platformRouter.post(
  "/schools/:id/reactivate",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.billing.manage"),
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
    const parsed = reactivateSchoolSchema.safeParse(req.body);
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
      const result = await setSubscription(
        req.prisma,
        req.params.id ?? "",
        {
          plan: parsed.data.plan,
          status: "ACTIVE",
          currentPeriodStart: new Date(`${parsed.data.periodStart}T00:00:00Z`),
          currentPeriodEnd: new Date(`${parsed.data.periodEnd}T00:00:00Z`),
        },
        req.user.userId,
        "SUBSCRIPTION_STATUS_CHANGE",
      );
      res.json({ success: true, data: { subscription: result }, error: null, meta: null });
    } catch (err) {
      sendBillingError(res, err);
    }
  }),
);

// POST /platform/schools/:id/plan — plan change, same period. A raise
// takes effect immediately (caps unblock admissions); downgrades never
// delete anything (§16.1, no proration — full effect next period save for
// the cap, which is immediate by construction of effectivePlan()).
platformRouter.post(
  "/schools/:id/plan",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.billing.manage"),
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
    const parsed = billingPlanSchema.safeParse(req.body);
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
      const school = await req.prisma.school.findUnique({ where: { id: req.params.id } });
      if (!school) {
        sendBillingError(res, new AuthError(404, "SCHOOL_NOT_FOUND", "School not found."));
        return;
      }
      const sub = await req.prisma.subscription.findUnique({ where: { schoolId: school.id } });
      const result = await setSubscription(
        req.prisma,
        school.id,
        {
          plan: parsed.data.plan,
          status: (sub?.status ?? school.subscriptionStatus) as "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED",
          currentPeriodStart: sub?.currentPeriodStart,
          currentPeriodEnd: sub?.currentPeriodEnd,
        },
        req.user.userId,
        "SUBSCRIPTION_PLAN_CHANGE",
      );
      res.json({ success: true, data: { subscription: result }, error: null, meta: null });
    } catch (err) {
      sendBillingError(res, err);
    }
  }),
);

// POST /platform/schools/:id/trial-extension — moves schools.trialEndsAt
// forward. Must be a FUTURE date: backdating would silently expire a trial.
platformRouter.post(
  "/schools/:id/trial-extension",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.billing.manage"),
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
    const parsed = trialExtensionSchema.safeParse(req.body);
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
      const school = await req.prisma.school.findUnique({ where: { id: req.params.id } });
      if (!school) {
        sendBillingError(res, new AuthError(404, "SCHOOL_NOT_FOUND", "School not found."));
        return;
      }
      const trialEndsAt = new Date(`${parsed.data.trialEndsAt}T00:00:00Z`);
      if (trialEndsAt.getTime() <= Date.now()) {
        sendBillingError(res, new AuthError(400, "VALIDATION_ERROR", "Trial end must be a future date."));
        return;
      }
      const updated = await req.prisma.school.update({ where: { id: school.id }, data: { trialEndsAt } });
      await recordAudit(req.prisma, {
        schoolId: school.id,
        actorId: req.user.userId,
        action: "SUBSCRIPTION_TRIAL_EXTENDED",
        entity: "School",
        entityId: school.id,
        after: { id: school.id, trialEndsAt: trialEndsAt.toISOString() },
      });
      res.json({ success: true, data: { trialEndsAt: updated.trialEndsAt }, error: null, meta: null });
    } catch (err) {
      sendBillingError(res, err);
    }
  }),
);

// GET /platform/schools/:id/subscription — one school's billing picture:
// mirror fields, subscription row (nullable pre-billing), latest invoices.
platformRouter.get(
  "/schools/:id/subscription",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.billing.manage"),
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
    const school = await req.prisma.school.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, slug: true, subscriptionStatus: true, plan: true, trialEndsAt: true, isDemo: true },
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
    const subscription = await req.prisma.subscription.findUnique({ where: { schoolId: school.id } });
    const invoices = await req.prisma.subscriptionInvoice.findMany({
      where: { schoolId: school.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json({ success: true, data: { school, subscription, invoices }, error: null, meta: null });
  }),
);

// GET /platform/subscription-invoices — newest first, optional school.
platformRouter.get(
  "/subscription-invoices",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.billing.manage"),
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
    const parsed = subscriptionInvoiceListSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid query." },
        meta: null,
      });
      return;
    }
    const invoices = await req.prisma.subscriptionInvoice.findMany({
      where: { ...(parsed.data.schoolId ? { schoolId: parsed.data.schoolId } : {}) },
      orderBy: { createdAt: "desc" },
      take: parsed.data.take,
    });
    res.json({ success: true, data: { invoices }, error: null, meta: null });
  }),
);

// POST /platform/subscription-invoices — owner issues a bill (period-keyed,
// idempotent like the cycle's own issuance).
platformRouter.post(
  "/subscription-invoices",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.billing.manage"),
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
    const parsed = issueSubscriptionInvoiceSchema.safeParse(req.body);
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
      const school = await req.prisma.school.findUnique({ where: { id: parsed.data.schoolId } });
      if (!school) {
        sendBillingError(res, new AuthError(404, "SCHOOL_NOT_FOUND", "School not found."));
        return;
      }
      const invoice = await issueInvoice(
        req.prisma,
        school.id,
        {
          plan: parsed.data.plan,
          periodStart: new Date(`${parsed.data.periodStart}T00:00:00Z`),
          periodEnd: new Date(`${parsed.data.periodEnd}T00:00:00Z`),
          schoolState: school.state,
          platformState: process.env.PLATFORM_STATE ?? null,
        },
        req.user.userId,
      );
      res.status(201).json({ success: true, data: { invoice }, error: null, meta: null });
    } catch (err) {
      sendBillingError(res, err);
    }
  }),
);

// POST /platform/subscription-invoices/:id/mark-paid — the baseline §16.1
// collection path: owner records payment (MANUAL), audited, reversible
// states only (PAID re-pays are no-ops, never double-credits).
platformRouter.post(
  "/subscription-invoices/:id/mark-paid",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.billing.manage"),
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
    try {
      const result = await markInvoicePaid(req.prisma, req.params.id ?? "", req.user.userId);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendBillingError(res, err);
    }
  }),
);

// ---------------------------------------------------------------------------
// Users Management (§7 #23, Chunk 3): account administration ONLY —
// activate/deactivate, role assignment. Never academic data (no pupil
// records, marks, fees, or messages here — those live in tenant routes the
// owner never touches). Every write audited (§13.10 must-list).
// Hard guardrails (fail closed, tested both directions):
// - PLATFORM_OWNER accounts are never assigned or unassigned through here
//   (owner creation stays manual/out-of-band, §13.4 — no public owner
//   creation, and no privileged escalation path either);
// - nobody deactivates or re-roles their OWN account (self-lockout).
// ---------------------------------------------------------------------------

const userListSchema = z.object({
  schoolId: z.string().trim().min(1).max(64).optional(),
  role: z.string().trim().min(1).max(32).optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
});

const userActiveSchema = z.object({
  isActive: z.boolean(),
});

const userRoleSchema = z.object({
  role: z.string().trim().min(1).max(32),
});

// GET /platform/users — cross-tenant account roster (ids, emails, roles,
// schools, active flags). No academic rows, ever.
platformRouter.get(
  "/users",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.users.read"),
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
    const parsed = userListSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid query." },
        meta: null,
      });
      return;
    }
    const users = await req.prisma.user.findMany({
      where: {
        ...(parsed.data.schoolId ? { schoolId: parsed.data.schoolId } : {}),
        ...(parsed.data.role ? { role: { name: parsed.data.role } } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        createdAt: true,
        role: { select: { name: true } },
        school: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take: parsed.data.take,
    });
    res.json({ success: true, data: { users }, error: null, meta: null });
  }),
);

async function loadManagedUser(db: NonNullable<Request["prisma"]>, id: string) {
  return db.user.findUnique({
    where: { id },
    include: { role: true, school: { select: { id: true, name: true } } },
  });
}

function forbidOwnerTouch(res: Response): void {
  res.status(403).json({
    success: false,
    data: null,
    error: { code: "FORBIDDEN", message: "Platform Owner accounts are managed out-of-band, never through this panel." },
    meta: null,
  });
}

// PATCH /platform/users/:id — deactivate / reactivate. Deactivation locks
// the account at next login/token use (login checks isActive; live access
// tokens expire within 15 minutes — the standard short-tail, not a bug).
platformRouter.patch(
  "/users/:id",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.users.manage"),
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
    const parsed = userActiveSchema.safeParse(req.body);
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
      const target = await loadManagedUser(req.prisma, req.params.id ?? "");
      if (!target) {
        sendBillingError(res, new AuthError(404, "USER_NOT_FOUND", "User not found."));
        return;
      }
      if (target.role.name === "PLATFORM_OWNER") {
        forbidOwnerTouch(res);
        return;
      }
      if (target.id === req.user.userId) {
        sendBillingError(res, new AuthError(403, "FORBIDDEN", "You cannot deactivate your own account."));
        return;
      }
      if (target.isActive === parsed.data.isActive) {
        res.json({ success: true, data: { user: { id: target.id, isActive: target.isActive }, unchanged: true }, error: null, meta: null });
        return;
      }
      const updated = await req.prisma.user.update({
        where: { id: target.id },
        data: { isActive: parsed.data.isActive },
      });
      await recordAudit(req.prisma, {
        schoolId: target.schoolId,
        actorId: req.user.userId,
        action: parsed.data.isActive ? "USER_REACTIVATE" : "USER_DEACTIVATE",
        entity: "User",
        entityId: target.id,
        before: { id: target.id, role: target.role.name, isActive: target.isActive },
        after: { id: updated.id, role: target.role.name, isActive: updated.isActive },
      });
      res.json({ success: true, data: { user: { id: updated.id, isActive: updated.isActive } }, error: null, meta: null });
    } catch (err) {
      sendBillingError(res, err);
    }
  }),
);

// PATCH /platform/users/:id/role — reassign a role (any non-owner role).
// Before/after role names are the audited fact (§13.10 role changes).
platformRouter.patch(
  "/users/:id/role",
  authMiddleware,
  platformOnlyMiddleware,
  requirePermission("platform.users.manage"),
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
    const parsed = userRoleSchema.safeParse(req.body);
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
      const target = await loadManagedUser(req.prisma, req.params.id ?? "");
      if (!target) {
        sendBillingError(res, new AuthError(404, "USER_NOT_FOUND", "User not found."));
        return;
      }
      if (target.role.name === "PLATFORM_OWNER" || parsed.data.role === "PLATFORM_OWNER") {
        forbidOwnerTouch(res);
        return;
      }
      if (target.id === req.user.userId) {
        sendBillingError(res, new AuthError(403, "FORBIDDEN", "You cannot change your own role."));
        return;
      }
      const role = await req.prisma.role.findUnique({ where: { name: parsed.data.role } });
      if (!role) {
        sendBillingError(res, new AuthError(400, "VALIDATION_ERROR", "Unknown role."));
        return;
      }
      if (role.id === target.roleId) {
        res.json({ success: true, data: { user: { id: target.id, role: target.role.name }, unchanged: true }, error: null, meta: null });
        return;
      }
      const updated = await req.prisma.user.update({
        where: { id: target.id },
        data: { roleId: role.id },
      });
      await recordAudit(req.prisma, {
        schoolId: target.schoolId,
        actorId: req.user.userId,
        action: "USER_ROLE_CHANGE",
        entity: "User",
        entityId: target.id,
        before: { id: target.id, role: target.role.name, isActive: target.isActive },
        after: { id: updated.id, role: role.name, isActive: target.isActive },
      });
      res.json({ success: true, data: { user: { id: updated.id, role: role.name } }, error: null, meta: null });
    } catch (err) {
      sendBillingError(res, err);
    }
  }),
);
