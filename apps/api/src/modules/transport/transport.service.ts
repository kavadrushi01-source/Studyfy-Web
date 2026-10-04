import type { Prisma, PrismaClient } from "@prisma/client";
import { AuthError } from "../auth/auth.service.js";
import type {
  AddStopInput,
  AssignRiderInput,
  CreateRouteInput,
  CreateVehicleInput,
  UpdateRouteInput,
  UpdateStopInput,
  UpdateVehicleInput,
} from "./transport.schemas.js";

// Transport (§7 Phase 2 #14): routes with ordered stops, vehicles with
// drivers, one assignment per pupil. Office (transport.manage) runs it;
// everyone with transport.read sees routes/vehicles, pupils/parents see
// only their own/linked ride via studentScope pins. Cross-tenant safety
// from tenantMiddleware + TENANT_MODELS, proven by the stranger-school
// test in the suite.
export async function listRoutes(db: PrismaClient) {
  const rows = await db.busRoute.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      stops: { select: { id: true, name: true, stopOrder: true, pickupTime: true }, orderBy: { stopOrder: "asc" } },
      vehicles: { select: { id: true, number: true, capacity: true, driverName: true, driverPhone: true } },
      _count: { select: { assignments: true } },
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { name: "asc" },
  });
  return {
    routes: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      stops: r.stops,
      vehicles: r.vehicles,
      riderCount: r._count.assignments,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };
}

export async function createRoute(db: PrismaClient, schoolId: string, input: CreateRouteInput) {
  const route = await db.busRoute.create({
    data: { schoolId, name: input.name, description: input.description },
    select: { id: true, name: true, description: true },
  });
  return { route };
}

export async function updateRoute(db: PrismaClient, routeId: string, input: UpdateRouteInput) {
  const route = await db.busRoute.findFirst({ where: { id: routeId }, select: { id: true } });
  if (!route) {
    throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
  }
  const updated = await db.busRoute.update({
    where: { id: route.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
  return { route: { id: updated.id, name: updated.name, description: updated.description } };
}

export async function deleteRoute(db: PrismaClient, routeId: string) {
  const route = await db.busRoute.findFirst({ where: { id: routeId }, select: { id: true, name: true } });
  if (!route) {
    throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
  }
  const riders = await db.studentTransport.count({ where: { routeId: route.id } });
  if (riders > 0) {
    throw new AuthError(409, "RIDERS_ASSIGNED", `Cannot remove a route with ${riders} rider${riders === 1 ? "" : "s"} assigned.`);
  }
  // Stops go with the route (cascade); vehicles stay, unassigned.
  await db.$transaction([
    db.busStop.deleteMany({ where: { routeId: route.id } }),
    db.busRoute.delete({ where: { id: route.id } }),
  ]);
  return { deleted: route.id, name: route.name };
}

// Renumber a route's stops dense 1..N in run order. Moving/inserting
// never leaves gaps or duplicates, no matter the requested position.
// Two phases (negative temps first): renumbering one row at a time would
// trip the @@unique([routeId, stopOrder]) constraint mid-sequence.
async function renumberStops(tx: Prisma.TransactionClient, orderedIds: string[]): Promise<void> {
  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index];
    if (!id) {
      continue;
    }
    await tx.busStop.update({ where: { id }, data: { stopOrder: -(index + 1) } });
  }
  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index];
    if (!id) {
      continue;
    }
    await tx.busStop.update({ where: { id }, data: { stopOrder: index + 1 } });
  }
}

export async function addStop(db: PrismaClient, routeId: string, input: AddStopInput) {
  const route = await db.busRoute.findFirst({ where: { id: routeId }, select: { id: true, schoolId: true } });
  if (!route) {
    throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
  }
  const stop = await db.$transaction(async (tx) => {
    const existing = await tx.busStop.findMany({
      where: { routeId: route.id },
      select: { id: true },
      orderBy: { stopOrder: "asc" },
    });
    const ids = existing.map((s) => s.id);
    const created = await tx.busStop.create({
      data: { schoolId: route.schoolId, routeId: route.id, name: input.name, stopOrder: ids.length + 1, pickupTime: input.pickupTime ?? null },
    });
    const at = input.stopOrder === undefined ? ids.length : Math.min(Math.max(input.stopOrder - 1, 0), ids.length);
    ids.splice(at, 0, created.id);
    await renumberStops(tx, ids);
    return tx.busStop.findFirstOrThrow({ where: { id: created.id } });
  });
  return { stop };
}

export async function updateStop(db: PrismaClient, stopId: string, input: UpdateStopInput) {
  const stop = await db.busStop.findFirst({ where: { id: stopId }, select: { id: true, routeId: true } });
  if (!stop) {
    throw new AuthError(404, "STOP_NOT_FOUND", "Stop not found in this school.");
  }
  const updated = await db.$transaction(async (tx) => {
    const current = await tx.busStop.findFirstOrThrow({ where: { id: stop.id } });
    if (input.stopOrder !== undefined && input.stopOrder !== current.stopOrder) {
      const siblings = await tx.busStop.findMany({
        where: { routeId: stop.routeId, id: { not: stop.id } },
        select: { id: true },
        orderBy: { stopOrder: "asc" },
      });
      const ids = siblings.map((s) => s.id);
      ids.splice(Math.min(Math.max(input.stopOrder - 1, 0), ids.length), 0, stop.id);
      await renumberStops(tx, ids);
    }
    // stopOrder is owned by renumberStops above (clamped + dense) — the
    // raw request value never writes directly, or the sequence breaks.
    // An order-only move has nothing left to set; return the fresh row.
    if (input.name === undefined && input.pickupTime === undefined) {
      return tx.busStop.findFirstOrThrow({ where: { id: stop.id } });
    }
    return tx.busStop.update({
      where: { id: stop.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.pickupTime !== undefined ? { pickupTime: input.pickupTime } : {}),
      },
    });
  });
  return { stop: updated };
}

export async function deleteStop(db: PrismaClient, stopId: string) {
  const stop = await db.busStop.findFirst({ where: { id: stopId }, select: { id: true, name: true, routeId: true } });
  if (!stop) {
    throw new AuthError(404, "STOP_NOT_FOUND", "Stop not found in this school.");
  }
  const riders = await db.studentTransport.count({ where: { stopId: stop.id } });
  if (riders > 0) {
    throw new AuthError(409, "RIDERS_ASSIGNED", "Move riders off this stop before removing it.");
  }
  await db.$transaction(async (tx) => {
    await tx.busStop.delete({ where: { id: stop.id } });
    const rest = await tx.busStop.findMany({
      where: { routeId: stop.routeId },
      select: { id: true },
      orderBy: { stopOrder: "asc" },
    });
    await renumberStops(tx, rest.map((s) => s.id));
  });
  return { deleted: stop.id, name: stop.name };
}

export async function listVehicles(db: PrismaClient) {
  const rows = await db.busVehicle.findMany({
    select: {
      id: true,
      number: true,
      capacity: true,
      driverName: true,
      driverPhone: true,
      routeId: true,
      route: { select: { id: true, name: true } },
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { number: "asc" },
  });
  return { vehicles: rows };
}

export async function createVehicle(db: PrismaClient, schoolId: string, input: CreateVehicleInput) {
  if (input.routeId) {
    const route = await db.busRoute.findFirst({ where: { id: input.routeId }, select: { id: true } });
    if (!route) {
      throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
    }
  }
  const vehicle = await db.busVehicle.create({
    data: {
      schoolId,
      number: input.number,
      capacity: input.capacity,
      driverName: input.driverName,
      driverPhone: input.driverPhone,
      routeId: input.routeId ?? null,
    },
  });
  return { vehicle };
}

export async function updateVehicle(db: PrismaClient, vehicleId: string, input: UpdateVehicleInput) {
  const vehicle = await db.busVehicle.findFirst({ where: { id: vehicleId }, select: { id: true } });
  if (!vehicle) {
    throw new AuthError(404, "VEHICLE_NOT_FOUND", "Vehicle not found in this school.");
  }
  if (input.routeId) {
    const route = await db.busRoute.findFirst({ where: { id: input.routeId }, select: { id: true } });
    if (!route) {
      throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
    }
  }
  const updated = await db.busVehicle.update({
    where: { id: vehicle.id },
    data: {
      ...(input.number !== undefined ? { number: input.number } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.driverName !== undefined ? { driverName: input.driverName } : {}),
      ...(input.driverPhone !== undefined ? { driverPhone: input.driverPhone } : {}),
      ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
    },
  });
  return { vehicle: updated };
}

export async function deleteVehicle(db: PrismaClient, vehicleId: string) {
  const vehicle = await db.busVehicle.findFirst({ where: { id: vehicleId }, select: { id: true, number: true } });
  if (!vehicle) {
    throw new AuthError(404, "VEHICLE_NOT_FOUND", "Vehicle not found in this school.");
  }
  await db.busVehicle.delete({ where: { id: vehicle.id } });
  return { deleted: vehicle.id, number: vehicle.number };
}

export async function assignRider(db: PrismaClient, input: AssignRiderInput) {
  const [student, route, stop] = await Promise.all([
    db.student.findFirst({ where: { id: input.studentId }, select: { id: true, schoolId: true, user: { select: { name: true } } } }),
    db.busRoute.findFirst({ where: { id: input.routeId }, select: { id: true, name: true } }),
    db.busStop.findFirst({ where: { id: input.stopId }, select: { id: true, name: true, routeId: true } }),
  ]);
  if (!student) {
    throw new AuthError(404, "STUDENT_NOT_FOUND", "Student not found in this school.");
  }
  if (!route) {
    throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
  }
  if (!stop || stop.routeId !== route.id) {
    throw new AuthError(404, "STOP_NOT_FOUND", "Stop not found on this route.");
  }
  // One ride per pupil: re-assigning moves them. (No upsert: the tenant
  // extension injects schoolId into every where, which breaks upsert's
  // unique-where contract — find-then-write instead.)
  const existing = await db.studentTransport.findFirst({ where: { studentId: student.id }, select: { id: true } });
  const assignment = existing
    ? await db.studentTransport.update({
      where: { id: existing.id },
      data: { routeId: route.id, stopId: stop.id },
      select: {
        id: true,
        student: { select: { id: true, user: { select: { name: true } } } },
        route: { select: { id: true, name: true } },
        stop: { select: { id: true, name: true, stopOrder: true, pickupTime: true } },
      },
    })
    : await db.studentTransport.create({
      data: { schoolId: student.schoolId, studentId: student.id, routeId: route.id, stopId: stop.id },
      select: {
        id: true,
        student: { select: { id: true, user: { select: { name: true } } } },
        route: { select: { id: true, name: true } },
        stop: { select: { id: true, name: true, stopOrder: true, pickupTime: true } },
      },
    });
  return { assignment };
}

export async function unassignRider(db: PrismaClient, studentId: string) {
  const existing = await db.studentTransport.findFirst({ where: { studentId }, select: { id: true } });
  if (!existing) {
    throw new AuthError(404, "ASSIGNMENT_NOT_FOUND", "This pupil has no transport assignment.");
  }
  await db.studentTransport.delete({ where: { id: existing.id } });
  return { removed: existing.id };
}

export interface RideRow {
  student: { id: string; name: string };
  route: { id: string; name: string };
  stop: { id: string; name: string; stopOrder: number; pickupTime: string | null };
  vehicle: { id: string; number: string; driverName: string; driverPhone: string | null } | null;
}

export async function myRides(
  db: PrismaClient,
  allowedIds: string[] | null,
): Promise<{ rides: RideRow[] }> {
  const rows = await db.studentTransport.findMany({
    where: allowedIds ? { studentId: { in: allowedIds } } : {},
    select: {
      student: { select: { id: true, user: { select: { name: true } } } },
      route: {
        select: {
          id: true,
          name: true,
          vehicles: { select: { id: true, number: true, driverName: true, driverPhone: true }, take: 1 },
        },
      },
      stop: { select: { id: true, name: true, stopOrder: true, pickupTime: true } },
    },
    orderBy: { student: { user: { name: "asc" } } },
  });
  return {
    rides: rows.map((r) => ({
      student: { id: r.student.id, name: r.student.user.name },
      route: { id: r.route.id, name: r.route.name },
      stop: r.stop,
      vehicle: r.route.vehicles[0] ?? null,
    })),
  };
}
