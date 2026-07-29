import { z } from "zod";

export const createDepartmentSchema = z.object({
  name: z.string().min(2).max(150),
  description: z.string().max(1000).optional(),
});
export type CreateDepartmentDto = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  description: z.string().max(1000).optional(),
});
export type UpdateDepartmentDto = z.infer<typeof updateDepartmentSchema>;

export const departmentIdParamSchema = z.object({
  id: z.string().uuid(),
});
