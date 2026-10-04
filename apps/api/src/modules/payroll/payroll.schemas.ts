import { z } from "zod";

const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const attendanceStatusSchema = z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]);

export const markAttendanceSchema = z.object({
  staffId: z.string().trim().min(1).max(40),
  date: z.string().trim().regex(dateRegex, "Date must be YYYY-MM-DD."),
  status: attendanceStatusSchema,
});

export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const listAttendanceSchema = z.object({
  staffId: z.string().trim().min(1).max(40).optional(),
  month: z.string().trim().regex(monthRegex, "Month must be YYYY-MM.").optional(),
});

export type ListAttendanceInput = z.infer<typeof listAttendanceSchema>;

const leaveDate = z.string().trim().regex(dateRegex, "Leave dates must be YYYY-MM-DD.");

export const requestLeaveSchema = z.object({
  // Omitted by staff filing for themselves (resolved from the login);
  // the office passes an explicit staffer.
  staffId: z.string().trim().min(1).max(40).optional(),
  dates: z.array(leaveDate).min(1).max(60),
  reason: z.string().trim().min(1).max(1000),
});

export type RequestLeaveInput = z.infer<typeof requestLeaveSchema>;

export const decideLeaveSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

export type DecideLeaveInput = z.infer<typeof decideLeaveSchema>;

export const listLeavesSchema = z.object({
  staffId: z.string().trim().min(1).max(40).optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

export type ListLeavesInput = z.infer<typeof listLeavesSchema>;

export const computePayrollSchema = z.object({
  staffId: z.string().trim().min(1).max(40),
  month: z.string().trim().regex(monthRegex, "Month must be YYYY-MM."),
  baseSalary: z.number().positive().max(100000000),
});

export type ComputePayrollInput = z.infer<typeof computePayrollSchema>;

export const listPayrollSchema = z.object({
  staffId: z.string().trim().min(1).max(40).optional(),
  month: z.string().trim().regex(monthRegex, "Month must be YYYY-MM.").optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListPayrollInput = z.infer<typeof listPayrollSchema>;
