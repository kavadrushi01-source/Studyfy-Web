import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { schoolDay } from "../../lib/school-time.js";
import { AuthError } from "../auth/auth.service.js";
import { invalidateAttendanceKpis } from "../metrics/metrics.service.js";
import type { ImportPunchesInput, MapDeviceInput, RegisterDeviceInput } from "./biometric.schemas.js";

export interface DeviceInfo {
  id: string;
  schoolId: string;
  name: string;
}

// Device keys are bearer secrets with no expiry and no rotation UI in v1,
// so they get the password treatment: shown ONCE at registration, stored
// only as sha256 hex. Constant-time compare — the hash is not a password
// hash (no bcrypt cost; devices authenticate per-punch-batch, not per tap),
// but equality must still not leak prefix information.
export function hashDeviceKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey, "utf8").digest("hex");
}

function keysEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function registerDevice(
  db: PrismaClient,
  schoolId: string,
  input: RegisterDeviceInput,
): Promise<{ device: DeviceInfo & { location: string | null; isActive: boolean }; deviceKey: string }> {
  const rawKey = `bio_${crypto.randomBytes(32).toString("hex")}`;
  const created = await db.biometricDevice.create({
    data: {
      schoolId,
      name: input.name,
      location: input.location,
      apiKeyHash: hashDeviceKey(rawKey),
    },
  });
  return {
    device: { id: created.id, schoolId, name: created.name, location: created.location, isActive: created.isActive },
    deviceKey: rawKey,
  };
}

export async function listDevices(db: PrismaClient, schoolId: string) {
  const rows = await db.biometricDevice.findMany({
    where: { schoolId },
    select: { id: true, name: true, location: true, isActive: true, lastSeenAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return { devices: rows };
}

export async function setDeviceActive(
  db: PrismaClient,
  schoolId: string,
  deviceId: string,
  isActive: boolean,
) {
  const device = await db.biometricDevice.findFirst({ where: { id: deviceId, schoolId } });
  if (!device) {
    throw new AuthError(404, "DEVICE_NOT_FOUND", "Device not found in this school.");
  }
  const updated = await db.biometricDevice.update({ where: { id: device.id }, data: { isActive } });
  return { device: { id: updated.id, name: updated.name, isActive: updated.isActive } };
}

export async function mapPupilDevice(db: PrismaClient, schoolId: string, input: MapDeviceInput) {
  const student = await db.student.findFirst({ where: { id: input.studentId, schoolId } });
  if (!student) {
    throw new AuthError(404, "NOT_FOUND", "Student not found.");
  }
  if (input.deviceUserId !== null) {
    const holder = await db.student.findFirst({
      where: { schoolId, deviceUserId: input.deviceUserId },
      select: { id: true },
    });
    if (holder && holder.id !== student.id) {
      throw new AuthError(409, "DEVICE_ID_TAKEN", "That device ID is already mapped to another pupil.");
    }
  }
  const updated = await db.student.update({
    where: { id: student.id },
    data: { deviceUserId: input.deviceUserId },
    select: { id: true, deviceUserId: true },
  });
  return { mapping: updated };
}

// Machine actor (§7 Phase 3 #21): no JWT exists for a terminal, so this
// runs on the RAW client with the device's own schoolId — same shape as
// the Razorpay webhook (§13.8). The URL school must equal the device's
// school (checked in the middleware); everything below re-pins to it.
export async function importPunches(
  db: PrismaClient,
  device: DeviceInfo,
  input: ImportPunchesInput,
): Promise<{ marked: number; unknown: string[]; dates: string[] }> {
  const school = await db.school.findUnique({ where: { id: device.schoolId }, select: { timezone: true } });
  if (!school) {
    throw new AuthError(404, "SCHOOL_NOT_FOUND", "School not found.");
  }
  const ids = [...new Set(input.punches.map((p) => p.deviceUserId))];
  const pupils = await db.student.findMany({
    where: { schoolId: device.schoolId, deviceUserId: { in: ids } },
    select: { id: true, deviceUserId: true, sectionId: true },
  });
  const byDeviceId = new Map(pupils.map((p) => [p.deviceUserId ?? "", p]));
  const unknown: string[] = [];
  const marks: { studentId: string; sectionId: string; date: Date }[] = [];
  for (const punch of input.punches) {
    const pupil = byDeviceId.get(punch.deviceUserId);
    if (!pupil) {
      if (!unknown.includes(punch.deviceUserId)) {
        unknown.push(punch.deviceUserId);
      }
      continue;
    }
    // The terminal stamps wall-clock time; the school day owns the date
    // (§12.7) — a 23:40 tap in IST is the next UTC day but today at school.
    const day = schoolDay(school.timezone, new Date(punch.timestamp));
    marks.push({ studentId: pupil.id, sectionId: pupil.sectionId, date: new Date(`${day}T00:00:00Z`) });
  }
  // One row per pupil per day wins (first tap counts; re-taps are no-ops,
  // same overwrite contract as manual marking).
  const seen = new Set<string>();
  const writes = marks.filter((m) => {
    const k = `${m.studentId}@${m.date.toISOString()}`;
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
  await db.$transaction(
    writes.map((w) =>
      db.attendance.upsert({
        where: { studentId_date: { studentId: w.studentId, date: w.date } },
        update: { status: "PRESENT", sectionId: w.sectionId, markedById: null },
        create: {
          schoolId: device.schoolId,
          studentId: w.studentId,
          sectionId: w.sectionId,
          date: w.date,
          status: "PRESENT",
          markedById: null,
        },
      }),
    ),
  );
  await db.biometricDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  invalidateAttendanceKpis(device.schoolId);
  const dates = [...new Set(writes.map((w) => w.date.toISOString().slice(0, 10)))].sort();
  return { marked: writes.length, unknown, dates };
}

// Device authentication: x-device-key header, hashed and compared against
// the registry. House convention for middleware (tenant/rbac): respond
// directly with the envelope — thrown errors from middleware land on the
// generic 500 fallback, since per-route sendXError only wraps handlers.
// Fail-closed 401 on missing/unknown/suspended keys; a key from ANOTHER
// school is 403, never silently re-scoped (same TENANT_MODELS discipline
// as JWT routes — the URL schoolId is untrusted input).
export async function deviceKeyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const deny = (status: number, code: string, message: string): void => {
    res.status(status).json({ success: false, data: null, error: { code, message }, meta: null });
  };
  try {
    const raw = req.header("x-device-key") ?? "";
    if (!raw) {
      deny(401, "DEVICE_UNAUTHORIZED", "A device key is required.");
      return;
    }
    const { prisma } = await import("../../lib/prisma.js");
    const device = await prisma.biometricDevice.findUnique({
      where: { apiKeyHash: hashDeviceKey(raw) },
      select: { id: true, schoolId: true, name: true, isActive: true, apiKeyHash: true },
    });
    // The unique index already matched, but equality is decided by a
    // constant-time comparison — never by the index probe alone.
    if (!device || !keysEqual(hashDeviceKey(raw), device.apiKeyHash)) {
      deny(401, "DEVICE_UNAUTHORIZED", "Unknown device key.");
      return;
    }
    if (!device.isActive) {
      deny(401, "DEVICE_UNAUTHORIZED", "This device is suspended.");
      return;
    }
    if (device.schoolId !== req.params.schoolId) {
      deny(403, "TENANT_MISMATCH", "This device does not belong to this school.");
      return;
    }
    req.device = { id: device.id, schoolId: device.schoolId, name: device.name };
    next();
  } catch {
    deny(500, "INTERNAL_ERROR", "Something went wrong.");
  }
}
