import { z } from "zod";

export const createRouteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
});

export type CreateRouteInput = z.infer<typeof createRouteSchema>;

export const updateRouteSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: "Provide at least one field to update.",
  });

export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;

export const addStopSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Position in the run order; gaps allowed, collisions resolved by push.
  stopOrder: z.number().int().min(1).max(500).optional(),
  pickupTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pickup time must be HH:MM (24-hour).")
    .optional(),
});

export type AddStopInput = z.infer<typeof addStopSchema>;

export const updateStopSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    stopOrder: z.number().int().min(1).max(500).optional(),
    pickupTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pickup time must be HH:MM (24-hour).")
      .nullable()
      .optional(),
  })
  .refine((v) => v.name !== undefined || v.stopOrder !== undefined || v.pickupTime !== undefined, {
    message: "Provide at least one field to update.",
  });

export type UpdateStopInput = z.infer<typeof updateStopSchema>;

export const createVehicleSchema = z.object({
  number: z.string().trim().min(1).max(30),
  capacity: z.number().int().min(1).max(200),
  driverName: z.string().trim().min(1).max(120),
  driverPhone: z.string().trim().min(1).max(20).optional(),
  routeId: z.string().trim().min(1).max(40).nullable().optional(),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object({
    number: z.string().trim().min(1).max(30).optional(),
    capacity: z.number().int().min(1).max(200).optional(),
    driverName: z.string().trim().min(1).max(120).optional(),
    driverPhone: z.string().trim().min(1).max(20).nullable().optional(),
    routeId: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .refine(
    (v) =>
      v.number !== undefined ||
      v.capacity !== undefined ||
      v.driverName !== undefined ||
      v.driverPhone !== undefined ||
      v.routeId !== undefined,
    { message: "Provide at least one field to update." },
  );

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

export const assignRiderSchema = z.object({
  studentId: z.string().trim().min(1).max(40),
  routeId: z.string().trim().min(1).max(40),
  stopId: z.string().trim().min(1).max(40),
});

export type AssignRiderInput = z.infer<typeof assignRiderSchema>;
