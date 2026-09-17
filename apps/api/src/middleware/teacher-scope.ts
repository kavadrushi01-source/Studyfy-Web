import type { NextFunction, Request, Response } from "express";

// Teacher section scope (§9.1 classTeacherId): a teacher sees only students
// in sections they are the class teacher for — never the whole school.
// Mounts AFTER authMiddleware + tenantMiddleware (needs req.user and the
// scoped req.prisma). Any other role passes through (students/parents are
// pinned by studentSelfScope; staff-wide reads are an RBAC decision).
// Fail-closed: teacher login without a staff profile, or with no assigned
// sections, sees an empty list — never everything.
export function teacherSectionScope(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  const db = req.prisma;
  if (!user || !db) {
    res.status(500).json({
      success: false,
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
      meta: null,
    });
    return;
  }
  if (user.role !== "TEACHER") {
    next();
    return;
  }
  db.staff
    .findFirst({ where: { userId: user.userId }, select: { id: true } })
    .then((staff) => {
      if (!staff) {
        req.sectionScope = [];
        next();
        return;
      }
      return db.section
        .findMany({ where: { classTeacherId: staff.id }, select: { id: true } })
        .then((sections) => {
          req.sectionScope = sections.map((s) => s.id);
          next();
        });
    })
    .catch(next);
}
