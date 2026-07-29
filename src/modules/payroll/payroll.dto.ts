import { z } from "zod";
import { PayrollStatus } from "@prisma/client";

export const generatePayrollSchema = z.object({
  periodMonth: z.coerce.number().int().min(1).max(12),
  periodYear: z.coerce.number().int().min(2020).max(2100),
});
export type GeneratePayrollDto = z.infer<typeof generatePayrollSchema>;

export const updatePayrollSchema = z.object({
  bonus: z.coerce.number().nonnegative().optional(),
  penalty: z.coerce.number().nonnegative().optional(),
});
export type UpdatePayrollDto = z.infer<typeof updatePayrollSchema>;

export const listPayrollQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  periodMonth: z.string().optional(),
  periodYear: z.string().optional(),
  status: z.nativeEnum(PayrollStatus).optional(),
});
export type ListPayrollQuery = z.infer<typeof listPayrollQuerySchema>;

export const payrollIdParamSchema = z.object({
  id: z.string().uuid(),
});
