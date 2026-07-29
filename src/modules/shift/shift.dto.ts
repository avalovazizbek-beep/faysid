import { z } from "zod";
import { ShiftType } from "@prisma/client";

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const createShiftSchema = z.object({
  name: z.string().min(2).max(150),
  type: z.nativeEnum(ShiftType).default(ShiftType.NORMAL),
  startTime: z.string().regex(timePattern, "HH:mm formatida bo'lishi kerak"),
  endTime: z.string().regex(timePattern, "HH:mm formatida bo'lishi kerak"),
  lateThresholdMinutes: z.coerce.number().int().min(0).max(180).default(15),
  workingHoursPerDay: z.coerce.number().int().min(1).max(24).default(8),
});
export type CreateShiftDto = z.infer<typeof createShiftSchema>;

export const updateShiftSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  type: z.nativeEnum(ShiftType).optional(),
  startTime: z.string().regex(timePattern).optional(),
  endTime: z.string().regex(timePattern).optional(),
  lateThresholdMinutes: z.coerce.number().int().min(0).max(180).optional(),
  workingHoursPerDay: z.coerce.number().int().min(1).max(24).optional(),
});
export type UpdateShiftDto = z.infer<typeof updateShiftSchema>;

export const shiftIdParamSchema = z.object({
  id: z.string().uuid(),
});
