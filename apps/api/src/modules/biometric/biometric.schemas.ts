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

const punchSchema = z.object({
  deviceUserId: z.string().trim().min(1).max(64),
  timestamp: z.string().trim().datetime({ message: "Timestamp must be ISO-8601." }),
});

// Bounded like bulk marking (500): a terminal dumping thousands of rows in
// one call is a backlog to page through, not a single request.
export const importPunchesSchema = z.object({
  punches: z.array(punchSchema).min(1).max(500),
});

export type ImportPunchesInput = z.infer<typeof importPunchesSchema>;
