# Security Patterns — Reference Code

This is the single most important file in the rebuild. The v1 build's worst
bug (any student could read any other student's full profile, attendance,
marks, fees, and library history) happened because tenant scoping and
row-level self-scoping were written by hand, per-route, and some routes were
missed. This file gives you a pattern that fails closed instead of failing
silently — adapt the exact code to your schema, but keep the shape.

Write the regression tests in §4 **before** you make them pass, per
`RULES.md` §6/§6.1 — that ordering is the actual fix, not the code itself.

## 1. Tenant-scoping via a Prisma Client Extension

Prisma's `$use` middleware API is deprecated — use a **Client Extension**
(`$extends`) instead, applied to every tenant-scoped model automatically so a
developer can't forget a `where: { schoolId }` on a one-off query.

```typescript
// apps/api/src/lib/prisma-tenant.ts
import { PrismaClient } from '@prisma/client';

// Every model listed here MUST have a `schoolId` column.
// Add new tenant-scoped models to this list in the SAME COMMIT you add them
// to schema.prisma — v1's exact failure mode was 11 models added to the
// schema without being added to a list just like this one.
export const TENANT_MODELS = [
  'User', 'Student', 'Staff', 'Class', 'Section', 'AcademicYear', 'Subject',
  'StudentGuardian', 'TeacherSubject', 'Attendance', 'FeeStructure',
  'FeeInvoice', 'FeePayment', 'Exam', 'ExamSubject', 'Mark', 'ExamRemark',
  'TimetableSlot', 'Homework', 'HomeworkSubmission', 'Notice', 'Message',
  'Document', 'AuditLog', 'Payroll', 'MessageGroup', 'Book', 'BookIssue',
  'Vehicle', 'TransportRoute', 'StudentRoute', 'Enquiry',
  'Ticket', 'TicketMessage', 'InventoryItem', 'InventoryMovement', 'BiometricDevice',
  'Subscription', 'SubscriptionInvoice', 'AuditLog',
] as const;
// NOT on the list (global, like roles/permissions §9.1): BillingCounter —
// a per-financial-year invoice-number counter with no school to scope to.
// Case in point #1: `AcademicYear` and `Subject` were missing from this
// exact list until a review caught them against spec §9.1's ER diagram,
// after they'd already been described in the schema elsewhere.
// Case in point #2: `StudentGuardian` (spec §9.1's join table, added when
// the single parent_id FK was replaced with a proper many-to-many
// guardian relationship) was ALSO missing from this list until the same
// kind of review caught it — added the same day the join table itself
// was designed.
// Case in point #3: `TeacherSubject` (spec §9.1) wasn't even in the
// schema at all until it surfaced while writing Phase 1 build prompts —
// a stage well past schema design and past several dedicated review
// passes. If a table can go missing this late, "I'll remember to add it"
// was never a real control.
// Three strikes on the exact failure mode this list exists to prevent, in
// the same file, within one build. `ExamRemark` and `BiometricDevice`
// (Phase 3, §9.1) are the first two additions that made it into this list
// in the SAME pass as the schema decision itself, not caught afterward —
// that's the discipline actually working, for once. Don't take that as
// permission to relax it; it worked this time because someone checked,
// not because the risk went away.
// Re-check this list against §9.1 every
// single time the schema changes — "I'll remember" isn't a control, this
// list having every model in it is.
// Deliberately NOT on this list: `Role`, `Permission`, `RolePermission`.
// Unlike Subject (genuinely different per school) these are a fixed,
// global set the whole platform shares — "Teacher" means the same thing
// and carries the same permissions everywhere. Making every school
// duplicate identical copies of them would be pointless complexity, not
// tenant isolation. Seed them once, globally; only the *assignment* of a
// role to a specific user is tenant-scoped, and that's already covered by
// the user row itself having `school_id`.

const READ_OPS = ['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy'];
const WRITE_OPS = ['update', 'delete', 'updateMany', 'deleteMany', 'upsert'];

export function scopedPrismaClient(prisma: PrismaClient, schoolId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && (TENANT_MODELS as readonly string[]).includes(model)) {
            if (READ_OPS.includes(operation) || WRITE_OPS.includes(operation)) {
              args.where = { ...(args.where ?? {}), schoolId };
            }
            if (operation === 'create') {
              args.data = { ...(args.data ?? {}), schoolId };
            }
          }
          return query(args);
        },
      },
    },
  });
}
```

```typescript
// apps/api/src/middleware/tenant.ts
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { scopedPrismaClient } from '../lib/prisma-tenant';

// req.user is set by authMiddleware after verifying the JWT — never by
// reading a header or body field the client controls.
export function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  const schoolId = req.user?.schoolId;
  if (!schoolId) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing school context' } });
  }

  // Routes under /schools/:schoolId/... (spec §10) must match the token —
  // a mismatch means the URL was edited by hand or by a malicious client.
  if (req.params.schoolId && req.params.schoolId !== schoolId) {
    return res.status(403).json({ success: false, error: { code: 'TENANT_MISMATCH', message: 'Forbidden' } });
  }

  req.prisma = scopedPrismaClient(prisma, schoolId);
  req.schoolId = schoolId;
  next();
}
```

Every controller uses `req.prisma`, never the raw unscoped `prisma` client,
for anything touching a `TENANT_MODELS` entry.

**Two things not to do with `scopedPrismaClient`:**
- **Don't cache or reuse a scoped client across requests.** Create it fresh,
  per request, from that request's verified `req.user.schoolId` — a cached
  client keyed wrong (or not keyed at all) is exactly how one tenant's data
  ends up scoped to another tenant's request.
- **Don't call it from `POST /auth/register`.** That route creates the
  school itself, so there's no `school_id` yet to scope with — it uses the
  raw `prisma` client directly for that one write (spec §8.3, §13.4), then
  every subsequent request from the new admin goes through the normal path.

## 2. The Platform Owner exception

Spec §5 and §13.4: the Platform Owner isn't tied to any school
(`school_id IS NULL` on their user row) and their routes — listing every
school, suspending one, platform analytics — are legitimately cross-tenant.
Running them through `tenantMiddleware` above would either 401-reject a
valid Platform Owner request (no `school_id` to derive) or, worse, silently
scope a "give me all schools" query down to one school if you tried to force
it through. This needs a separate, parallel middleware, not a special case
bolted onto `tenantMiddleware`:

```typescript
// apps/api/src/middleware/platform-only.ts
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';

export function platformOnlyMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'PLATFORM_OWNER') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Platform access only' } });
  }
  // Deliberately the RAW, unscoped client — these queries are meant to see
  // every school. Any filtering (e.g. "schools on the Basic plan") is a
  // normal `where` clause the controller writes explicitly, not something
  // the tenant extension does for you here.
  req.prisma = prisma;
  next();
}
```

Mount `/api/v1/platform/...` routes with `authMiddleware` +
`platformOnlyMiddleware` — never `tenantMiddleware`. Mount every
`/api/v1/schools/:schoolId/...` route with `authMiddleware` +
`tenantMiddleware` — never `platformOnlyMiddleware`. A non-public route should
never have two auth paths, or none. §5 covers the other two paths that exist
now: device keys (biometric/RFID sync) and the shared secret for scheduled jobs.

## 3. Row-level self-scope for Student/Parent

This sits after `tenantMiddleware` + `rbacMiddleware`, on any route that
returns a specific student's data (profile, attendance, marks, fees,
library history). The rule that actually matters: **if no student is
specified, default to the caller's own — never let an omitted filter fall
through to "all students."** That fallthrough was v1's exact bug.

```typescript
// apps/api/src/middleware/selfscope.ts
import { Request, Response, NextFunction } from 'express';

export async function applyStudentSelfScope(req: Request, res: Response, next: NextFunction) {
  const { role, userId } = req.user!;

  if (role === 'STUDENT') {
    const ownStudentId = await getStudentIdForUser(req.prisma, userId);
    const requested = req.params.studentId ?? (req.query.studentId as string | undefined);
    if (requested && requested !== ownStudentId) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not your record' } });
    }
    req.params.studentId = ownStudentId; // force it — don't trust an absent filter
  }

  if (role === 'PARENT') {
    const linkedChildIds = await getChildIdsForParent(req.prisma, userId);
    const requested = req.params.studentId ?? (req.query.studentId as string | undefined);
    if (requested && !linkedChildIds.includes(requested)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not your child' } });
    }
    if (!requested) {
      req.query.studentIds = linkedChildIds; // adapt to however your list endpoints filter
    }
  }

  next();
}

// For endpoints that join/compute results before you can push a WHERE clause
// into the query, filter the assembled rows before they leave the handler —
// don't rely on the DB filter alone.
export function filterVisibleRows<T extends { studentId: string }>(
  rows: T[],
  allowedStudentIds: string[],
): T[] {
  return rows.filter((r) => allowedStudentIds.includes(r.studentId));
}
```

`getStudentIdForUser` / `getChildIdsForParent` are small lookups you write
against your actual `Student` / `student_guardians` join table (spec §9.1 —
a many-to-many join, not a single FK, since a student can have more than
one guardian and a guardian more than one child) — the point of this file
is the fail-closed structure around them, not the lookup itself.

## 4. Regression tests — write these first

These tests create their own minimal fixtures (`schoolA`/`schoolB`,
`studentA`/`studentB`, etc. below) — they don't depend on `prisma/seed.ts`
or `DEMO_DATA.md`'s two named schools having been run first. That's
deliberate: CI (`.github/workflows/ci.yml`) runs against a fresh, empty test
database on every run, and a test suite that only passes after a separate
seed step has executed is slower and more fragile than one that's fully
self-contained. Use School of Science / Ramakrishna School for manual
testing and demos; use small ad-hoc fixtures like the ones below for
automated tests.

```typescript
// apps/api/tests/tenant-isolation.test.ts
describe('tenant isolation', () => {
  it('rejects a token for school A reading school B\'s students', async () => {
    const token = await loginAs(schoolA.admin);
    const res = await request(app)
      .get(`/api/v1/schools/${schoolB.id}/students`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('student/parent self-scope', () => {
  it('rejects a student reading another student\'s record', async () => {
    const token = await loginAs(studentA);
    const res = await request(app)
      .get(`/api/v1/schools/${school.id}/students/${studentB.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('rejects a parent reading a non-linked child\'s record', async () => {
    const token = await loginAs(parentLinkedToStudentAOnly);
    const res = await request(app)
      .get(`/api/v1/schools/${school.id}/students/${studentB.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('a student fetching their own record with no id specified gets their own, not a list of everyone\'s', async () => {
    const token = await loginAs(studentA);
    const res = await request(app)
      .get(`/api/v1/schools/${school.id}/students/me/attendance`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.data.studentId).toBe(studentA.id);
  });
});

describe('platform owner routes', () => {
  it('rejects a School Admin (not a Platform Owner) hitting /platform/schools', async () => {
    const token = await loginAs(schoolA.admin);
    const res = await request(app)
      .get('/api/v1/platform/schools')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('a Platform Owner can see schools across tenants', async () => {
    const token = await loginAs(platformOwner); // no schoolId on this account
    const res = await request(app)
      .get('/api/v1/platform/schools')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: any) => s.id)).toEqual(
      expect.arrayContaining([schoolA.id, schoolB.id]),
    );
  });
});
```

Per `RULES.md` §6/§6.1: these tests exist and pass **before** Phase 1 feature
modules start, not added after an audit finds a problem.

## 5. Other auth paths, and Phase 4's guards

Same caveat as the rest of this file: these are patterns to adapt and verify
against your real schema and `package.json`, not drop-in code.

### 5.1 Device keys (Phase 3 — biometric/RFID sync)

```typescript
// apps/api/src/middleware/device-auth.ts
import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { scopedPrismaClient } from '../lib/prisma-tenant';

// Device keys are long random strings (generate >= 32 random bytes), so a
// fast hash (SHA-256) is the right way to store them — bcrypt is for
// low-entropy human passwords and would only slow every sync call down.
export async function deviceAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const presented = req.header('x-device-key');
  if (!presented) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing device key' } });
  }
  const apiKeyHash = crypto.createHash('sha256').update(presented).digest('hex');

  // The ONE query here that uses the raw client: it's the lookup that
  // establishes which school this device belongs to (same reasoning as
  // POST /auth/register). Everything after it uses the scoped client.
  // Revoked devices must not match — however revocation is modelled in your
  // schema (a revokedAt column, or deleting the row).
  const device = await prisma.biometricDevice.findFirst({ where: { apiKeyHash, revokedAt: null } });
  if (!device) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Invalid device key' } });
  }
  req.schoolId = device.schoolId;
  req.deviceId = device.id;
  req.prisma = scopedPrismaClient(prisma, device.schoolId);
  next();
}
```

### 5.2 Scheduled-job secret (Phase 4)

```typescript
// apps/api/src/middleware/cron-auth.ts
import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

export function cronAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.CRON_SECRET ?? '';
  // Fail closed: an unset or short secret means NO job endpoint works —
  // never "no check".
  if (expected.length < 32) {
    return res.status(503).json({ success: false, error: { code: 'JOBS_DISABLED', message: 'Jobs are not configured' } });
  }
  const presented = Buffer.from(req.header('x-cron-secret') ?? '');
  const wanted = Buffer.from(expected);
  // timingSafeEqual needs equal lengths, so check length first.
  if (presented.length !== wanted.length || !crypto.timingSafeEqual(presented, wanted)) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Bad job secret' } });
  }
  next();
}

// Inside a job handler: per-school work always uses a per-school scoped client.
// const schools = await prisma.school.findMany({ where: { isDemo: false }, select: { id: true } });
// for (const { id } of schools) {
//   const db = scopedPrismaClient(prisma, id);   // as in §1
//   await runFeeRemindersForSchool(db, id);      // idempotent: skips what it already sent
// }
```

### 5.3 Read-only sessions: impersonation (and optional read-only demo accounts)

```typescript
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Mount on every tenant route and on /platform routes, right after authMiddleware.
export function blockWritesWhenReadOnlySession(req: Request, res: Response, next: NextFunction) {
  const readOnly = Boolean(req.user?.impersonatedBy) || Boolean(req.user?.readOnly);
  if (readOnly && !SAFE_METHODS.has(req.method)) {
    return res.status(403).json({ success: false, error: { code: 'READ_ONLY_SESSION', message: 'This session is read-only' } });
  }
  next();
}

// HTTP verbs are not the only way to write. Reject these at the Socket.io handshake:
// io.use((socket, next) => {
//   const payload = verifyJwt(socket.handshake.auth.token);
//   if (payload.impersonatedBy || payload.readOnly) return next(new Error('READ_ONLY_SESSION'));
//   ...
// });

// Anything that records "seen/read" on a GET must skip it while impersonating:
// if (!req.user.impersonatedBy) await markNoticeRead(...);
```

### 5.4 Audit-log field allowlists

```typescript
// One allowlist per audited entity — never "serialize the row and strip a few".
const AUDIT_FIELDS: Record<string, readonly string[]> = {
  Mark: ['studentId', 'examSubjectId', 'score'],
  User: ['id', 'role', 'isActive'],              // never passwordHash, never tokens
  FeeInvoice: ['id', 'studentId', 'status', 'amount'],
  School: ['id', 'subscriptionStatus', 'plan'],
};

export function pickAuditFields(entity: string, row: Record<string, unknown>) {
  const allowed = AUDIT_FIELDS[entity];
  if (!allowed) throw new Error(`No audit allowlist for ${entity} — add one; do not log the whole row`);
  return Object.fromEntries(allowed.filter((k) => k in row).map((k) => [k, row[k]]));
}
```

### 5.5 Regression tests to write first for these

- Device: no key → 401; a revoked key → 401 immediately; a valid key for school A
  can't write school B's attendance.
- Cron: no secret → 401; wrong secret → 401; `CRON_SECRET` unset → 503, never "open".
- Read-only: a write with an impersonation token → 403; a socket connect with it is
  refused; a notice read under impersonation records no read receipt.
- Audit: logging an entity with no allowlist throws; a logged `User` row contains no
  `passwordHash`; there is no code path that updates or deletes an audit row.

Per `RULES.md` §6/§6.1: write these first and watch them fail, as with every
other test in this file.
