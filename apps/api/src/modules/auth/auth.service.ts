import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { recordAudit } from "../../lib/audit.js";
import { prisma } from "../../lib/prisma.js";
import { schoolAccess } from "../billing/billing.service.js";
import { signAccessToken } from "../../lib/jwt.js";
import { slugifyName, uniqueSlug } from "../../lib/slug.js";
import { MailerUnconfiguredError, mailerFor } from "../../lib/mailer.js";
import { invalidateOwnerBoards } from "../metrics/metrics.service.js";
import type { ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput } from "./auth.schemas.js";

const BCRYPT_COST = 12; // spec §8.3 / RULES.md §2: cost ≥ 10
const TRIAL_DAYS = 14;
const REFRESH_DAYS = 7;

export const INVALID_CREDENTIALS = "Invalid email or password.";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: string;
  schoolId: string | null;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

interface UserWithRole {
  id: string;
  email: string;
  name: string;
  schoolId: string | null;
  passwordHash: string;
  isActive: boolean;
  role: { name: string };
}

export interface IdentityExtras {
  // STUDENT: admission identity. STAFF (teacher/accountant): staff record.
  // PARENT: linked children. ADMIN/OWNER: nothing extra.
  admissionNo: string | null;
  section: string | null;
  staffId: string | null;
  designation: string | null;
  children: { name: string; section: string }[];
}

// "My ID" backing for the profile page: everyone sees their own account id
// (already in PublicUser); this adds the role-meaningful identity beside
// it — a pupil's admission number, a staffer's staff record, a parent's
// linked children. Roots in the same tables as every scoped read, so the
// values shown here always agree with what each board shows.
export async function identityExtras(userId: string, role: string): Promise<IdentityExtras> {
  const empty: IdentityExtras = { admissionNo: null, section: null, staffId: null, designation: null, children: [] };
  if (role === "STUDENT") {
    const pupil = await prisma.student.findFirst({
      where: { userId },
      select: {
        admissionNo: true,
        rollNumber: true,
        section: { select: { name: true, class: { select: { name: true } } } },
      },
    });
    if (!pupil) {
      return empty;
    }
    return {
      ...empty,
      admissionNo: pupil.admissionNo,
      section: `${pupil.section.class.name} ${pupil.section.name}`,
    };
  }
  if (role === "TEACHER" || role === "ACCOUNTANT") {
    const staff = await prisma.staff.findFirst({ where: { userId }, select: { id: true, designation: true } });
    if (!staff) {
      return empty;
    }
    return { ...empty, staffId: staff.id, designation: staff.designation };
  }
  if (role === "PARENT") {
    const links = await prisma.studentGuardian.findMany({
      where: { parentId: userId },
      select: { student: { select: { user: { select: { name: true } }, section: { select: { name: true, class: { select: { name: true } } } } } } },
      orderBy: { student: { user: { name: "asc" } } },
    });
    return {
      ...empty,
      children: links.map((l) => ({ name: l.student.user.name, section: `${l.student.section.class.name} ${l.student.section.name}` })),
    };
  }
  return empty;
}

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function toPublicUser(row: UserWithRole): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role.name,
    schoolId: row.schoolId,
  };
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function refreshExpiry(): Date {
  return new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
}

async function issueRefreshToken(userId: string): Promise<string> {
  const raw = randomBytes(48).toString("hex");
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt: refreshExpiry() },
  });
  return raw;
}

function buildAuthResult(user: UserWithRole, refreshToken: string): AuthResult {
  const publicUser = toPublicUser(user);
  return {
    accessToken: signAccessToken({
      sub: publicUser.id,
      schoolId: publicUser.schoolId,
      role: publicUser.role,
    }),
    refreshToken,
    user: publicUser,
  };
}

async function loginUser(user: UserWithRole, password: string): Promise<AuthResult> {
  if (!user.isActive) {
    throw new AuthError(403, "ACCOUNT_DISABLED", "This account has been disabled.");
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new AuthError(401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS);
  }
  const refreshToken = await issueRefreshToken(user.id);
  return buildAuthResult(user, refreshToken);
}

// POST /auth/register — the ONE deliberate exception to tenant middleware
// (spec §8.3, §13.4): no school_id exists yet, so this uses the raw,
// unscoped Prisma client for exactly this write.
export async function register(
  input: RegisterInput,
): Promise<AuthResult & { school: { id: string; name: string; slug: string } }> {
  const adminRole = await prisma.role.findUnique({ where: { name: "SCHOOL_ADMIN" } });
  if (!adminRole) {
    throw new AuthError(500, "ROLES_NOT_SEEDED", "Roles are not seeded. Run the db seed script first.");
  }

  const base = input.slug ?? slugifyName(input.schoolName);
  const slug = await uniqueSlug(base, async (candidate) => {
    const existing = await prisma.school.findUnique({ where: { slug: candidate } });
    return existing !== null;
  });

  const passwordHash = await bcrypt.hash(input.adminPassword, BCRYPT_COST);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const school = await prisma.school.create({
    data: {
      name: input.schoolName,
      slug,
      phone: input.phone,
      email: input.email,
      city: input.city,
      state: input.state,
      subscriptionStatus: "TRIAL",
      trialEndsAt,
      users: {
        create: {
          roleId: adminRole.id,
          email: input.adminEmail,
          passwordHash,
          name: input.adminName,
        },
      },
    },
    include: { users: { include: { role: true } } },
  });

  const admin = school.users[0];
  if (!admin) {
    throw new AuthError(500, "REGISTRATION_FAILED", "School was created but the admin account was not.");
  }

  const auth = await loginUser(admin, input.adminPassword);
  // A new tenant reshapes every platform-board figure (§12.3).
  invalidateOwnerBoards();
  return { ...auth, school: { id: school.id, name: school.name, slug: school.slug } };
}

function assertTenantAccess(
  school: { subscriptionStatus: string; trialEndsAt: Date; isDemo: boolean },
  subscription: { status: string; currentPeriodEnd: Date | null } | null,
): void {
  // Same engine as tenantMiddleware (§13.4) — the login gate and the
  // request gate must agree, or an admin could log in but use nothing (or
  // vice versa). Demo exemption lives inside schoolAccess (§13.11).
  const access = schoolAccess(school, subscription);
  if (!access.allowed) {
    const message =
      access.code === "TRIAL_EXPIRED"
        ? "The free trial for this school has ended. Please contact your school administrator."
        : access.code === "SUBSCRIPTION_EXPIRED"
          ? "This school's subscription has expired. Please contact your school administrator to renew."
          : "This school's account is suspended. Please contact your school administrator.";
    throw new AuthError(403, access.code, message);
  }
}

// POST /auth/login — email + password + OPTIONAL school slug.
// Slug omitted => Platform Owner lookup (school_id IS NULL). Slug present =>
// (school_id, email) lookup inside that school (spec §8.3). Every miss path
// returns the same 401 so callers can't enumerate schools or accounts.
export async function login(input: LoginInput): Promise<AuthResult> {
  if (input.schoolSlug) {
    const school = await prisma.school.findUnique({ where: { slug: input.schoolSlug } });
    if (!school) {
      throw new AuthError(401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS);
    }
    const subscription = await prisma.subscription.findUnique({ where: { schoolId: school.id } });
    // Suspended-school login exception (§13.4): the check needs the role,
    // so the user lookup moves ahead of the gate ONLY for suspended
    // schools — every other shape keeps the exact old order (and the old
    // enumeration-safe 401s). A suspended admin logs in (to reach billing);
    // anyone else on a suspended school gets the same 403 as before, and
    // an unknown email gets the same 401 as a live school.
    const gate = schoolAccess(school, subscription);
    if (!gate.allowed && gate.code === "SCHOOL_SUSPENDED") {
      const candidate = await prisma.user.findUnique({
        where: { schoolId_email: { schoolId: school.id, email: input.email } },
        include: { role: true },
      });
      if (!candidate) {
        throw new AuthError(401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS);
      }
      if (candidate.role.name !== "SCHOOL_ADMIN") {
        throw new AuthError(403, "SCHOOL_SUSPENDED", "This school's account is suspended. Please contact your school administrator.");
      }
      return loginUser(candidate, input.password);
    }
    assertTenantAccess(school, subscription);
    const user = await prisma.user.findUnique({
      where: { schoolId_email: { schoolId: school.id, email: input.email } },
      include: { role: true },
    });
    if (!user) {
      throw new AuthError(401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS);
    }
    return loginUser(user, input.password);
  }

  const owner = await prisma.user.findFirst({
    where: { schoolId: null, email: input.email },
    include: { role: true },
  });
  if (!owner || owner.role.name !== "PLATFORM_OWNER") {
    throw new AuthError(401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS);
  }
  const auth = await loginUser(owner, input.password);
  // §13.10 must-list: every Platform Owner login is audited. Platform-level
  // row (NULL school) — invisible to all schools, visible to the Owner's own
  // /platform/audit-logs. Deliberately fail-closed: if the log write fails,
  // the login fails with it — a privileged session without its START row is
  // worse than a refused login. DEPLOY NOTE: audit_logs must be migrated
  // before this build serves (migrate deploy first, same as every chunk).
  await recordAudit(prisma, {
    schoolId: null,
    actorId: owner.id,
    action: "OWNER_LOGIN",
    entity: "User",
    entityId: owner.id,
    after: { id: owner.id, role: "PLATFORM_OWNER", isActive: owner.isActive },
  });
  return auth;
}

// POST /auth/refresh — single-use rotation with theft detection: the
// presented token is consumed (revoked_at + replaced_by) and the next one
// issued. Presenting an already-rotated token means theft — the whole chain
// is revoked and the caller must log in again.
export async function rotateRefreshToken(rawToken: string): Promise<AuthResult> {
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { include: { role: true } } },
  });
  if (!row) {
    throw new AuthError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired.");
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.refreshToken.delete({ where: { id: row.id } }).catch(() => undefined);
    throw new AuthError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired.");
  }
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AuthError(403, "REFRESH_TOKEN_REUSED", "Refresh token was already used. Please log in again.");
  }
  if (!row.user.isActive) {
    throw new AuthError(403, "ACCOUNT_DISABLED", "This account has been disabled.");
  }

  const replacement = randomBytes(48).toString("hex");
  await prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({
      data: { userId: row.userId, tokenHash: hashToken(replacement), expiresAt: refreshExpiry() },
    });
    await tx.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), replacedBy: created.id },
    });
  });

  return buildAuthResult(row.user, replacement);
}

// POST /auth/logout — revoke every live refresh token for the cookie's
// owner ("log out everywhere") and let the route clear the cookie.
// Idempotent by design: no cookie, unknown cookie, or already-revoked
// chain all succeed — logout must never 401. Note the honest limit:
// stateless access JWTs stay valid until their 15-minute expiry; logout
// kills renewal, not already-issued access tokens.
export async function logout(rawToken: string | undefined): Promise<{ loggedOut: boolean }> {
  if (rawToken) {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (row) {
      await prisma.refreshToken.deleteMany({ where: { userId: row.userId, revokedAt: null } });
    }
  }
  return { loggedOut: true };
}

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour, single use (§13.3).

export interface ForgotPasswordResult {
  emailed: boolean;
  // Raw token for in-process tests ONLY — the router never sends it (the
  // requester gets the same generic success either way; the token travels
  // by email). Returning it from the service keeps tests off the mailbox.
  debugToken: string | null;
}

// POST /auth/forgot-password — enumeration-safe by design: unknown email,
// wrong slug, and disabled accounts all return the identical success, so
// callers can't probe which accounts exist. A fresh token replaces any
// live ones (one active reset per user, never a pile). Email delivery is
// best-effort like every other mail path — the token row is the source of
// truth, not the inbox.
export async function requestPasswordReset(db: typeof prisma, input: ForgotPasswordInput): Promise<ForgotPasswordResult> {
  const user = input.schoolSlug
    ? await db.user.findFirst({
        where: { schoolId: { not: null }, email: input.email, school: { slug: input.schoolSlug } },
        include: { role: true, school: { select: { name: true, slug: true, isDemo: true } } },
      })
    : await db.user.findFirst({
        where: { schoolId: null, email: input.email },
        include: { role: true, school: { select: { name: true, slug: true, isDemo: true } } },
      });
  if (!user || !user.isActive) {
    return { emailed: false, debugToken: null };
  }
  await db.authToken.deleteMany({ where: { userId: user.id, type: "PASSWORD_RESET", consumedAt: null } });
  const raw = randomBytes(32).toString("hex");
  await db.authToken.create({
    data: { userId: user.id, type: "PASSWORD_RESET", tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });
  let emailed = false;
  try {
    const frontend = process.env.FRONTEND_ORIGIN?.split(",")[0]?.trim() || "http://localhost:3000";
    // Single choke point (§13.11): the demo guard lives in mailerFor(). The
    // platform owner (no school) is never demo — resets always send there.
    const schoolRef =
      user.schoolId && user.school ? { isDemo: user.school.isDemo, slug: user.school.slug } : { isDemo: false, slug: "platform" };
    const delivery = await mailerFor(schoolRef).sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      link: `${frontend}/reset-password?token=${raw}`,
      schoolName: user.school?.name ?? "Studyfy",
    });
    emailed = delivery === "sent";
  } catch (err) {
    if (!(err instanceof MailerUnconfiguredError)) {
      console.error("Password reset email delivery failed:", err);
    }
  }
  return { emailed, debugToken: raw };
}

// POST /auth/reset-password — the §13.3 single-use rule: unknown, expired,
// and already-consumed tokens all fail IDENTICALLY (no oracle for leaked
// links). Success consumes the token AND kills every live refresh chain,
// so a password change logs out all sessions including a thief's.
export async function resetPassword(
  db: typeof prisma,
  input: ResetPasswordInput,
): Promise<{ reset: boolean }> {
  const row = await db.authToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { user: true },
  });
  if (!row || row.type !== "PASSWORD_RESET" || row.consumedAt || row.expiresAt.getTime() < Date.now()) {
    throw new AuthError(401, "INVALID_RESET_TOKEN", "This reset link is invalid or has expired.");
  }
  if (!row.user.isActive) {
    throw new AuthError(403, "ACCOUNT_DISABLED", "This account has been disabled.");
  }
  await db.$transaction([
    db.authToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
    db.user.update({ where: { id: row.userId }, data: { passwordHash: await bcrypt.hash(input.newPassword, BCRYPT_COST) } }),
    db.refreshToken.deleteMany({ where: { userId: row.userId, revokedAt: null } }),
  ]);
  return { reset: true };
}
