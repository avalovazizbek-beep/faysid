import { z } from "zod";
import { LeaveStatus, LeaveType } from "@prisma/client";

export const createLeaveSchema = z.object({
  employeeId: z.string().uuid(),
  type: z.nativeEnum(LeaveType),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().max(1000).optional(),
});
export type CreateLeaveDto = z.infer<typeof createLeaveSchema>;

export const listLeavesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  status: z.nativeEnum(LeaveStatus).optional(),
  type: z.nativeEnum(LeaveType).optional(),
});
export type ListLeavesQuery = z.infer<typeof listLeavesQuerySchema>;

export const leaveIdParamSchema = z.object({
  id: z.string().uuid(),
});
