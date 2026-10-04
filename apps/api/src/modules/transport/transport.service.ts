import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
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

// Transport (§7 Phase 2 #14, founder schema): fleet-level vehicles,
// routes carrying their stops as an ordered JSON run
// ([{ name, pickupTime }]), and a student_routes join table — row
// presence IS the subscription (one active ride per pupil, re-assign
// moves them). Office (transport.manage) runs it; everyone with
// transport.read sees routes/vehicles, pupils/parents see only
// their own/linked ride via studentScope pins. Cross-tenant safety
// from tenantMiddleware + TENANT_MODELS, proven by the stranger-school
// test in the suite.
export interface Stop {
  name: string;
  pickupTime: string | null;
}

// Defensive read: stops are schemaless JSON — a hand-edited prod row
// must degrade to "fewer stops", never crash the board.
export function parseStops(value: unknown): Stop[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Stop[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec.name !== "string" || rec.name.length === 0) {
      continue;
    }
    out.push({ name: rec.name, pickupTime: typeof rec.pickupTime === "string" ? rec.pickupTime : null });
  }
  return out;
}

export async function listRoutes(db: PrismaClient) {
  const rows = await db.transportRoute.findMany({
    select: { id: true, name: true, stops: true, _count: { select: { riders: true } }, createdAt: true, updatedAt: true },
    orderBy: { name: "asc" },
  });
  return {
    routes: rows.map((r) => ({
      id: r.id,
      name: r.name,
      stops: parseStops(r.stops),
      riderCount: r._count.riders,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };
}

export async function createRoute(db: PrismaClient, schoolId: string, input: CreateRouteInput) {
  const stops: Stop[] = (input.stops ?? []).map((s) => ({ name: s.name, pickupTime: s.pickupTime ?? null }));
  const route = await db.transportRoute.create({
    data: { schoolId, name: input.name, stops: stops as unknown as Prisma.InputJsonValue },
    select: { id: true, name: true, stops: true },
  });
  return { route: { id: route.id, name: route.name, stops: parseStops(route.stops) } };
}

export async function updateRoute(db: PrismaClient, routeId: string, input: UpdateRouteInput) {
  const route = await db.transportRoute.findFirst({ where: { id: routeId }, select: { id: true } });
  if (!route) {
    throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
  }
  const updated = await db.transportRoute.update({
    where: { id: route.id },
    data: { name: input.name },
    select: { id: true, name: true, stops: true },
  });
  return { route: { id: updated.id, name: updated.name, stops: parseStops(updated.stops) } };
}

export async function deleteRoute(db: PrismaClient, routeId: string) {
  const route = await db.transportRoute.findFirst({ where: { id: routeId }, select: { id: true, name: true } });
  if (!route) {
    throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
  }
  const riders = await db.studentRoute.count({ where: { routeId: route.id } });
  if (riders > 0) {
    throw new AuthError(409, "RIDERS_ASSIGNED", `Cannot remove a route with ${riders} rider${riders === 1 ? "" : "s"} assigned.`);
  }
  await db.transportRoute.delete({ where: { id: route.id } });
  return { deleted: route.id, name: route.name };
}

async function writeStops(db: PrismaClient, routeId: string, stops: Stop[]) {
  const updated = await db.transportRoute.update({
    where: { id: routeId },
    data: { stops: stops as unknown as Prisma.InputJsonValue },
    select: { id: true, name: true, stops: true },
  });
  return { route: { id: updated.id, name: updated.name, stops: parseStops(updated.stops) } };
}

export async function addStop(db: PrismaClient, routeId: string, input: AddStopInput) {
  const route = await db.transportRoute.findFirst({ where: { id: routeId }, select: { id: true, stops: true } });
  if (!route) {
    throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
  }
  const stops = parseStops(route.stops);
  const at = input.at === undefined ? stops.length : Math.min(Math.max(input.at - 1, 0), stops.length);
  stops.splice(at, 0, { name: input.name, pickupTime: input.pickupTime ?? null });
  const result = await writeStops(db, route.id, stops);
  return { stop: { index: at, ...result.route.stops[at]! }, route: result.route };
}

export async function updateStop(db: PrismaClient, routeId: string, index: number, input: UpdateStopInput) {
  const route = await db.transportRoute.findFirst({ where: { id: routeId }, select: { id: true, stops: true } });
  if (!route) {
    throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
  }
  const stops = parseStops(route.stops);
  const current = stops[index];
  if (!current) {
    throw new AuthError(404, "STOP_NOT_FOUND", "Stop not found on this route.");
  }
  const next: Stop = {
    name: input.name ?? current.name,
    pickupTime: input.pickupTime !== undefined ? input.pickupTime : current.pickupTime,
  };
  stops.splice(index, 1);
  const at = input.at === undefined ? index : Math.min(Math.max(input.at - 1, 0), stops.length);
  stops.splice(at, 0, next);
  const result = await writeStops(db, route.id, stops);
  return { stop: { index: at, ...result.route.stops[at]! }, route: result.route };
}

export async function deleteStop(db: PrismaClient, routeId: string, index: number) {
  const route = await db.transportRoute.findFirst({ where: { id: routeId }, select: { id: true, name: true, stops: true } });
  if (!route) {
    throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
  }
  const stops = parseStops(route.stops);
  const removed = stops[index];
  if (!removed) {
    throw new AuthError(404, "STOP_NOT_FOUND", "Stop not found on this route.");
  }
  stops.splice(index, 1);
  await writeStops(db, route.id, stops);
  return { deleted: removed.name, routeId: route.id };
}

export async function listVehicles(db: PrismaClient) {
  const rows = await db.vehicle.findMany({
    select: { id: true, registrationNumber: true, capacity: true, driverName: true, createdAt: true, updatedAt: true },
    orderBy: { registrationNumber: "asc" },
  });
  return { vehicles: rows };
}

function vehicleExistsError(): AuthError {
  return new AuthError(409, "VEHICLE_EXISTS", "A vehicle with this registration number already exists.");
}

export async function createVehicle(db: PrismaClient, schoolId: string, input: CreateVehicleInput) {
  const dupe = await db.vehicle.findFirst({ where: { registrationNumber: input.registrationNumber }, select: { id: true } });
  if (dupe) {
    throw vehicleExistsError();
  }
  try {
    const vehicle = await db.vehicle.create({
      data: { schoolId, registrationNumber: input.registrationNumber, capacity: input.capacity, driverName: input.driverName },
    });
    return { vehicle };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw vehicleExistsError();
    }
    throw err;
  }
}

export async function updateVehicle(db: PrismaClient, vehicleId: string, input: UpdateVehicleInput) {
  const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId }, select: { id: true } });
  if (!vehicle) {
    throw new AuthError(404, "VEHICLE_NOT_FOUND", "Vehicle not found in this school.");
  }
  if (input.registrationNumber !== undefined) {
    const dupe = await db.vehicle.findFirst({
      where: { registrationNumber: input.registrationNumber, id: { not: vehicle.id } },
      select: { id: true },
    });
    if (dupe) {
      throw vehicleExistsError();
    }
  }
  try {
    const updated = await db.vehicle.update({
      where: { id: vehicle.id },
      data: {
        ...(input.registrationNumber !== undefined ? { registrationNumber: input.registrationNumber } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.driverName !== undefined ? { driverName: input.driverName } : {}),
      },
    });
    return { vehicle: updated };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw vehicleExistsError();
    }
    throw err;
  }
}

export async function deleteVehicle(db: PrismaClient, vehicleId: string) {
  const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId }, select: { id: true, registrationNumber: true } });
  if (!vehicle) {
    throw new AuthError(404, "VEHICLE_NOT_FOUND", "Vehicle not found in this school.");
  }
  await db.vehicle.delete({ where: { id: vehicle.id } });
  return { deleted: vehicle.id, registrationNumber: vehicle.registrationNumber };
}

export async function assignRider(db: PrismaClient, input: AssignRiderInput) {
  const [student, route] = await Promise.all([
    db.student.findFirst({ where: { id: input.studentId }, select: { id: true, schoolId: true, user: { select: { name: true } } } }),
    db.transportRoute.findFirst({ where: { id: input.routeId }, select: { id: true, name: true, stops: true } }),
  ]);
  if (!student) {
    throw new AuthError(404, "STUDENT_NOT_FOUND", "Student not found in this school.");
  }
  if (!route) {
    throw new AuthError(404, "ROUTE_NOT_FOUND", "Route not found in this school.");
  }
  // One ride per pupil: re-assigning moves them. (No upsert: the tenant
  // extension injects schoolId into every where, which breaks upsert's
  // unique-where contract — find-then-write instead, with a P2002
  // fallback so two simultaneous assigns resolve to one row, not a 500.)
  const selectShape = {
    id: true,
    student: { select: { id: true, user: { select: { name: true } } } },
    route: { select: { id: true, name: true, stops: true } },
  } as const;
  const existing = await db.studentRoute.findFirst({ where: { studentId: student.id }, select: { id: true } });
  let row;
  if (existing) {
    row = await db.studentRoute.update({ where: { id: existing.id }, data: { routeId: route.id }, select: selectShape });
  } else {
    try {
      row = await db.studentRoute.create({
        data: { schoolId: student.schoolId, studentId: student.id, routeId: route.id },
        select: selectShape,
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
        throw err;
      }
      const won = await db.studentRoute.findFirstOrThrow({ where: { studentId: student.id }, select: { id: true } });
      row = await db.studentRoute.update({ where: { id: won.id }, data: { routeId: route.id }, select: selectShape });
    }
  }
  return {
    assignment: {
      id: row.id,
      student: { id: row.student.id, name: row.student.user.name },
      route: { id: row.route.id, name: row.route.name, stops: parseStops(row.route.stops) },
    },
  };
}

export async function unassignRider(db: PrismaClient, studentId: string) {
  const existing = await db.studentRoute.findFirst({ where: { studentId }, select: { id: true } });
  if (!existing) {
    throw new AuthError(404, "ASSIGNMENT_NOT_FOUND", "This pupil has no transport assignment.");
  }
  await db.studentRoute.delete({ where: { id: existing.id } });
  return { removed: existing.id };
}

export interface RideRow {
  student: { id: string; name: string };
  route: { id: string; name: string; stops: Stop[] };
}

export async function myRides(db: PrismaClient, allowedIds: string[] | null): Promise<{ rides: RideRow[] }> {
  const rows = await db.studentRoute.findMany({
    where: allowedIds ? { studentId: { in: allowedIds } } : {},
    select: {
      student: { select: { id: true, user: { select: { name: true } } } },
      route: { select: { id: true, name: true, stops: true } },
    },
    orderBy: { student: { user: { name: "asc" } } },
  });
  return {
    rides: rows.map((r) => ({
      student: { id: r.student.id, name: r.student.user.name },
      route: { id: r.route.id, name: r.route.name, stops: parseStops(r.route.stops) },
    })),
  };
}
