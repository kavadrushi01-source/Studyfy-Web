import { z } from "zod";

// Biometric/RFID registry (§7 Phase 3 #21): device enrollment is an office
// action (same audience as attendance marking); punch import is a MACHINE
// action authed by device key, never JWT.
export const registerDeviceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  location: z.string().trim().max(120).optional(),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const setDeviceActiveSchema = z.object({
  isActive: z.boolean(),
});

export type SetDeviceActiveInput = z.infer<typeof setDeviceActiveSchema>;

// Maps one pupil to their device-side enrollment ID (null unmaps).
// IDs are per-school unique (schema constraint) so a punch resolves to
// exactly one pupil — or to the unknown list, never a guess.
export const mapDeviceSchema = z.object({
  studentId: z.string().trim().min(1).max(40),
  deviceUserId: z.string().trim().min(1).max(64).nullable(),
});

export type MapDeviceInput = z.infer<typeof mapDeviceSchema>;

// Device attendance sync (§7 Phase 3 #21): the terminal pushes presence
// events keyed by RFID tag / enrollment ID. Status is explicit per event
// — entry taps read PRESENT, exit/end-of-day sweeps may report ABSENT.
const syncEventSchema = z.object({
  tag: z.string().trim().min(1).max(64),
  timestamp: z.string().trim().datetime({ message: "Timestamp must be ISO-8601." }),
  status: z.enum(["PRESENT", "ABSENT"]).default("PRESENT"),
});

export const syncAttendanceSchema = z.object({
  events: z.array(syncEventSchema).min(1).max(500),
});

export type SyncAttendanceInput = z.infer<typeof syncAttendanceSchema>;
