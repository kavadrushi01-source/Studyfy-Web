import { z } from "zod";

const pickupTime = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pickup time must be HH:MM (24-hour).");

const stopSchema = z.object({
  name: z.string().trim().min(1).max(120),
  pickupTime: pickupTime.nullable().optional(),
});

export const createRouteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  stops: z.array(stopSchema).max(100).optional(),
});

export type CreateRouteInput = z.infer<typeof createRouteSchema>;

export const updateRouteSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;

export const addStopSchema = z.object({
  name: z.string().trim().min(1).max(120),
  pickupTime: pickupTime.optional(),
  // 1-based run position; omitted = appended. Clamped into range.
  at: z.number().int().min(1).max(500).optional(),
});

export type AddStopInput = z.infer<typeof addStopSchema>;

export const updateStopSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    pickupTime: pickupTime.nullable().optional(),
    at: z.number().int().min(1).max(500).optional(),
  })
  .refine((v) => v.name !== undefined || v.pickupTime !== undefined || v.at !== undefined, {
    message: "Provide at least one field to update.",
  });

export type UpdateStopInput = z.infer<typeof updateStopSchema>;

export const createVehicleSchema = z.object({
  registrationNumber: z.string().trim().min(1).max(30),
  capacity: z.number().int().min(1).max(200),
  driverName: z.string().trim().min(1).max(120),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object({
    registrationNumber: z.string().trim().min(1).max(30).optional(),
    capacity: z.number().int().min(1).max(200).optional(),
    driverName: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => v.registrationNumber !== undefined || v.capacity !== undefined || v.driverName !== undefined, {
    message: "Provide at least one field to update.",
  });

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

export const assignRiderSchema = z.object({
  studentId: z.string().trim().min(1).max(40),
  routeId: z.string().trim().min(1).max(40),
});

export type AssignRiderInput = z.infer<typeof assignRiderSchema>;
