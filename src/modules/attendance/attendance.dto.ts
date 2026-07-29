import { z } from "zod";
import { AttendanceType } from "@prisma/client";

export const checkInSchema = z.object({
  employeeId: z.string().uuid(),
  type: z.nativeEnum(AttendanceType).default(AttendanceType.MANUAL),
});
export type CheckInDto = z.infer<typeof checkInSchema>;

export const checkOutSchema = z.object({
  employeeId: z.string().uuid(),
});
export type CheckOutDto = z.infer<typeof checkOutSchema>;

export const listAttendanceQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  type: z.nativeEnum(AttendanceType).optional(),
  lateOnly: z.enum(["true", "false"]).optional(),
  search: z.string().optional(),
});
export type ListAttendanceQuery = z.infer<typeof listAttendanceQuerySchema>;
