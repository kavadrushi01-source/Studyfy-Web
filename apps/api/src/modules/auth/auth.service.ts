import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { signAccessToken } from "../../lib/jwt.js";
import { slugifyName, uniqueSlug } from "../../lib/slug.js";
import { invalidateOwnerBoards } from "../metrics/metrics.service.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";

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

function assertTenantAccess(school: { subscriptionStatus: string; trialEndsAt: Date }): void {
  if (school.subscriptionStatus === "SUSPENDED") {
    throw new AuthError(
      403,
      "SCHOOL_SUSPENDED",
      "This school's account is suspended. Please contact your school administrator.",
    );
  }
  if (school.subscriptionStatus === "TRIAL" && school.trialEndsAt.getTime() < Date.now()) {
    throw new AuthError(
      403,
      "TRIAL_EXPIRED",
      "The free trial for this school has ended. Please contact your school administrator.",
    );
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
    assertTenantAccess(school);
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
  return loginUser(owner, input.password);
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
