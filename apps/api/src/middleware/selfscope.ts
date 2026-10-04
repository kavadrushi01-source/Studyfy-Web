import type { NextFunction, Request, Response } from "express";

function forbidden(res: Response, message: string): void {
  res.status(403).json({ success: false, data: null, error: { code: "FORBIDDEN", message }, meta: null });
}

function broken(res: Response): void {
  res.status(500).json({
    success: false,
    data: null,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    meta: null,
  });
}

// Row-level self-scope for Student/Parent (spec §5, pattern §3). Mounts AFTER
// authMiddleware + tenantMiddleware on any route touching a specific
// student's data — it needs req.user AND the tenant-scoped req.prisma.
//
// The rule that matters: if no student is specified, default to the caller's
// own — never let an omitted filter fall through to "all students" (that
// fallthrough was v1's exact bug). STUDENT pins to [ownId]; PARENT pins to
// [linkedChildIds...] via the student_guardians JOIN (many-to-many, §9.1).
// Every other role passes through untouched (RBAC refines staff powers in
// its own box; Phase 0 only locks down students/parents).
export function studentSelfScope(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  const db = req.prisma;
  if (!user || !db) {
    broken(res);
    return;
  }
  if (user.role !== "STUDENT" && user.role !== "PARENT") {
    next();
    return;
  }

  const lookup =
    user.role === "STUDENT"
      ? db.student
          .findFirst({ where: { userId: user.userId }, select: { id: true } })
          .then((own) => {
            if (!own) {
              return null;
            }
            return [own.id];
          })
      : db.studentGuardian
          .findMany({ where: { parentId: user.userId }, select: { studentId: true } })
          .then((links) => links.map((l) => l.studentId));

  lookup
    .then((studentIds) => {
      if (!studentIds) {
        forbidden(res, "No student profile is linked to this account.");
        return;
      }
      req.studentScope = { studentIds };
      const requested = req.params.studentId;
      if (requested && !studentIds.includes(requested)) {
        forbidden(res, user.role === "STUDENT" ? "Not your record." : "Not your child.");
        return;
      }
      next();
    })
    .catch(next);
}

// Row-level self-scope for STAFF (same §3 shape as studentSelfScope, for
// payroll-shaped data). Mounts AFTER authMiddleware + tenantMiddleware on
// any route touching a specific staffer's data — it needs req.user AND
// the tenant-scoped req.prisma.
//
// The rule that matters, identical to §3: if no staffer is specified,
// default to the caller's own — never let an omitted filter fall through
// to "all staff" (that fallthrough was v1's exact bug, now for salaries).
// SCHOOL_ADMIN and ACCOUNTANT (the two roles holding payroll.manage)
// pass through untouched; every other role pins to [ownStaffId]
// resolved from the login. A login with no staff row is fail-closed
// (403, sees nothing) — same as a student login with no linked pupil.
const STAFF_MANAGERS = new Set(["SCHOOL_ADMIN", "ACCOUNTANT"]);

export function staffSelfScope(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  const db = req.prisma;
  if (!user || !db) {
    broken(res);
    return;
  }
  if (STAFF_MANAGERS.has(user.role)) {
    next();
    return;
  }

  db.staff
    .findFirst({ where: { userId: user.userId }, select: { id: true } })
    .then((own) => {
      if (!own) {
        forbidden(res, "No staff record is linked to this account.");
        return;
      }
      req.staffScope = { staffIds: [own.id] };
      const requested =
        req.params.staffId ?? (req.query.staffId as string | undefined) ?? (req.body as { staffId?: unknown } | undefined)?.staffId;
      if (typeof requested === "string" && requested !== own.id) {
        forbidden(res, "Not your record.");
        return;
      }
      next();
    })
    .catch(next);
}
