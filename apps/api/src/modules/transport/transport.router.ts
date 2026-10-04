import { Router, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { catchAsync } from "../../lib/async.js";
import { authMiddleware } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { studentSelfScope } from "../../middleware/selfscope.js";
import { tenantMiddleware } from "../../middleware/tenant.js";
import { AuthError } from "../auth/auth.service.js";
import {
  addStopSchema,
  assignRiderSchema,
  createRouteSchema,
  createVehicleSchema,
  updateRouteSchema,
  updateStopSchema,
  updateVehicleSchema,
} from "./transport.schemas.js";
import {
  addStop,
  assignRider,
  createRoute,
  createVehicle,
  deleteRoute,
  deleteStop,
  deleteVehicle,
  listRoutes,
  listVehicles,
  myRides,
  unassignRider,
  updateRoute,
  updateStop,
  updateVehicle,
} from "./transport.service.js";

export const transportRouter = Router();

function sendTransportError(res: Response, err: unknown): void {
  if (err instanceof AuthError) {
    res.status(err.status).json({ success: false, data: null, error: { code: err.code, message: err.message }, meta: null });
    return;
  }
  // Two admins editing one route at the same instant can collide on the
  // stop-order sequence: retry, don't 500.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({
      success: false,
      data: null,
      error: { code: "CONCURRENT_EDIT", message: "Someone just changed this route — please retry." },
      meta: null,
    });
    return;
  }
  throw err;
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({
    success: false,
    data: null,
    error: { code: "VALIDATION_ERROR", message },
    meta: null,
  });
}

function internalError(res: Response): void {
  res.status(500).json({
    success: false,
    data: null,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    meta: null,
  });
}

// Routes board (every school role with transport.read): routes with
// ordered stops, vehicles, and rider counts.
transportRouter.get(
  "/schools/:schoolId/transport/routes",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await listRoutes(req.prisma);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// New route (transport.manage).
transportRouter.post(
  "/schools/:schoolId/transport/routes",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = createRouteSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await createRoute(req.prisma, req.params.schoolId ?? "", parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Rename / re-describe a route (transport.manage).
transportRouter.patch(
  "/schools/:schoolId/transport/routes/:routeId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = updateRouteSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await updateRoute(req.prisma, req.params.routeId ?? "", parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Remove a route (transport.manage): refused while riders are assigned;
// stops go with it, vehicles stay unassigned.
transportRouter.delete(
  "/schools/:schoolId/transport/routes/:routeId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await deleteRoute(req.prisma, req.params.routeId ?? "");
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Add a stop (transport.manage): appended, or spliced at stopOrder with
// the run renumbered dense.
transportRouter.post(
  "/schools/:schoolId/transport/routes/:routeId/stops",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = addStopSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await addStop(req.prisma, req.params.routeId ?? "", parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Edit a stop (transport.manage).
transportRouter.patch(
  "/schools/:schoolId/transport/stops/:stopId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = updateStopSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await updateStop(req.prisma, req.params.stopId ?? "", parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Remove a stop (transport.manage): refused while riders board there.
transportRouter.delete(
  "/schools/:schoolId/transport/stops/:stopId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await deleteStop(req.prisma, req.params.stopId ?? "");
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Fleet board (transport.read).
transportRouter.get(
  "/schools/:schoolId/transport/vehicles",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.read"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await listVehicles(req.prisma);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Add a vehicle (transport.manage).
transportRouter.post(
  "/schools/:schoolId/transport/vehicles",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = createVehicleSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await createVehicle(req.prisma, req.params.schoolId ?? "", parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Edit a vehicle (transport.manage).
transportRouter.patch(
  "/schools/:schoolId/transport/vehicles/:vehicleId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = updateVehicleSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await updateVehicle(req.prisma, req.params.vehicleId ?? "", parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Retire a vehicle (transport.manage).
transportRouter.delete(
  "/schools/:schoolId/transport/vehicles/:vehicleId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await deleteVehicle(req.prisma, req.params.vehicleId ?? "");
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Assign (or move) a rider (transport.manage): one ride per pupil.
transportRouter.post(
  "/schools/:schoolId/transport/assignments",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const parsed = assignRiderSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await assignRider(req.prisma, parsed.data);
      res.status(201).json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Unassign a rider (transport.manage).
transportRouter.delete(
  "/schools/:schoolId/transport/assignments/:studentId",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await unassignRider(req.prisma, req.params.studentId ?? "");
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// My ride (transport.read): staff see everything; STUDENT/PARENT are
// pinned to own/linked pupils, same §3 contract as fees.
transportRouter.get(
  "/schools/:schoolId/transport/rides",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.read"),
  studentSelfScope,
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    try {
      const result = await myRides(req.prisma, req.studentScope ? req.studentScope.studentIds : null);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);
