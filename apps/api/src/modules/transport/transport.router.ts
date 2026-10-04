import { Router, type Request, type Response } from "express";
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

// Stops live inside the route's JSON run — addressed by 0-based position,
// not by id. The UI numbers them from 1; the API takes the array index.
function parseIndex(raw: string | undefined, res: Response): number | null {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0 || index > 500) {
    badRequest(res, "Stop position must be a valid index.");
    return null;
  }
  return index;
}

// Routes board (every school role with transport.read): routes with
// their stop runs and rider counts.
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

// Rename a route (transport.manage).
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

// Remove a route (transport.manage): refused while riders are assigned.
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

// Add a stop (transport.manage): appended, or spliced at `at`.
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
  "/schools/:schoolId/transport/routes/:routeId/stops/:index",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const index = parseIndex(req.params.index, res);
    if (index === null) {
      return;
    }
    const parsed = updateStopSchema.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.issues[0]?.message ?? "Invalid request body.");
      return;
    }
    try {
      const result = await updateStop(req.prisma, req.params.routeId ?? "", index, parsed.data);
      res.json({ success: true, data: result, error: null, meta: null });
    } catch (err) {
      sendTransportError(res, err);
    }
  }),
);

// Remove a stop (transport.manage). Riders are route-level, so no
// boarding guard: the run simply shortens.
transportRouter.delete(
  "/schools/:schoolId/transport/routes/:routeId/stops/:index",
  authMiddleware,
  tenantMiddleware,
  requirePermission("transport.manage"),
  catchAsync(async (req: Request, res: Response) => {
    if (!req.prisma) {
      internalError(res);
      return;
    }
    const index = parseIndex(req.params.index, res);
    if (index === null) {
      return;
    }
    try {
      const result = await deleteStop(req.prisma, req.params.routeId ?? "", index);
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

// Assign (or move) a rider (transport.manage): one ride per pupil,
// row presence is the subscription.
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
