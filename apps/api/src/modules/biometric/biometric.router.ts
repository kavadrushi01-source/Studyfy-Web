import { Router, type Request, type Response } from "express";
import { catchAsync } from "../../lib/async.js";
import { prisma } from "../../lib/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import {
  importPunchesSchema,
  mapDeviceSchema,
  registerDeviceSchema,
  setDeviceActiveSchema,
} from "./biometric.schemas.js";
import {
  deviceKeyMiddleware,
  importPunches,
  listDevices,
  mapPupilDevice,
  registerDevice,
  setDeviceActive,
} from "./biometric.service.js";

export const biometricRouter = Router();

function sendBiometricError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  throw err;
}

// Device enrollment is an office action: attendance.mark holders who are
// admins (class teachers mark their own section's days; terminals belong
// to the school, so enrollment stays with the admin).
biometricRouter.post(
  "/schools/:schoolId/biometric/devices",
  authMiddleware,
  tenantMiddleware,
  requirePermission("attendance.mark"),
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
      sendBiometricError(res, new AuthError(403, "FORBIDDEN", "Only a School Admin may enroll devices."));
      return;
    }
    const parsed = registerDeviceSchema.safeParse(req.body);
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
      const result = await registerDevice(req.prisma, req.schoolId ?? "", parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendBiometricError(res, err);
    }
  }),
);

biometricRouter.get(
  "/schools/:schoolId/biometric/devices",
  authMiddleware,
  tenantMiddleware,
  requirePermission("attendance.mark"),
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
      sendBiometricError(res, new AuthError(403, "FORBIDDEN", "Only a School Admin may view devices."));
      return;
    }
    try {
      const result = await listDevices(req.prisma, req.schoolId ?? "");
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendBiometricError(res, err);
    }
  }),
);

biometricRouter.patch(
  "/schools/:schoolId/biometric/devices/:deviceId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("attendance.mark"),
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
      sendBiometricError(res, new AuthError(403, "FORBIDDEN", "Only a School Admin may manage devices."));
      return;
    }
    const parsed = setDeviceActiveSchema.safeParse(req.body);
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
      const result = await setDeviceActive(req.prisma, req.schoolId ?? "", req.params.deviceId ?? "", parsed.data.isActive);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendBiometricError(res, err);
    }
  }),
);

// Pupil ↔ enrollment-ID mapping (admin): which deviceUserId means which
// pupil. Unmapped IDs land on the punch response's unknown list, never a
// guess.
biometricRouter.post(
  "/schools/:schoolId/biometric/mappings",
  authMiddleware,
  tenantMiddleware,
  requirePermission("attendance.mark"),
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
      sendBiometricError(res, new AuthError(403, "FORBIDDEN", "Only a School Admin may map device IDs."));
      return;
    }
    const parsed = mapDeviceSchema.safeParse(req.body);
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
      const result = await mapPupilDevice(req.prisma, req.schoolId ?? "", parsed.data);
      res.status(200).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendBiometricError(res, err);
    }
  }),
);

// Terminal punch import (§7 Phase 3 #21): x-device-key auth, NO JWT chain —
// devices hold keys, not logins. Runs on the RAW client pinned to the
// device's own school (webhook precedent, §13.8).
biometricRouter.post(
  "/schools/:schoolId/attendance/device-punches",
  deviceKeyMiddleware,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.device) {
      res.status(500).json({
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
        meta: null,
      });
      return;
    }
    const parsed = importPunchesSchema.safeParse(req.body);
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
      const result = await importPunches(prisma, req.device, parsed.data);
      res.status(200).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendBiometricError(res, err);
    }
  }),
);
