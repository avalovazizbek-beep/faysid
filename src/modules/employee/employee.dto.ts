import { z } from "zod";
import { EmployeeStatus } from "@prisma/client";

export const createEmployeeSchema = z.object({
  employeeCode: z.string().min(1).max(50),
  fullName: z.string().min(2).max(200),
  phone: z.string().max(30).optional(),
  passportNumber: z.string().max(30).optional(),
  jshshir: z.string().max(20).optional(),
  position: z.string().max(150).optional(),
  departmentId: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
  salary: z.coerce.number().nonnegative().optional(),
  cardNumber: z.string().max(50).optional(),
  pinCode: z.string().regex(/^\d{4,8}$/, "PIN 4-8 xonali raqam bo'lishi kerak").optional(),
});
export type CreateEmployeeDto = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  phone: z.string().max(30).optional(),
  passportNumber: z.string().max(30).optional(),
  jshshir: z.string().max(20).optional(),
  position: z.string().max(150).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  shiftId: z.string().uuid().nullable().optional(),
  salary: z.coerce.number().nonnegative().optional(),
  status: z.nativeEnum(EmployeeStatus).optional(),
  cardNumber: z.string().max(50).optional(),
  pinCode: z.string().regex(/^\d{4,8}$/, "PIN 4-8 xonali raqam bo'lishi kerak").optional(),
});
export type UpdateEmployeeDto = z.infer<typeof updateEmployeeSchema>;

export const listEmployeesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  search: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  status: z.nativeEnum(EmployeeStatus).optional(),
});
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;

export const employeeIdParamSchema = z.object({
  id: z.string().uuid(),
});
