import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { ApiError } from "../../common/api-error";
import { sendCreated, sendSuccess } from "../../common/api-response";
import * as employeeService from "./employee.service";

function photoUrlFor(req: Request): string | undefined {
  return req.file ? `/uploads/employees/${req.file.filename}` : undefined;
}

export const createEmployeeHandler = asyncHandler(async (req: Request, res: Response) => {
  const employee = await employeeService.createEmployee(req.tenantId!, req.body, photoUrlFor(req));
  sendCreated(res, employee);
});

export const listEmployeesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, pagination } = await employeeService.listEmployees(req.tenantId!, req.query as Record<string, string>);
  sendSuccess(res, items, 200, pagination);
});

export const getEmployeeHandler = asyncHandler(async (req: Request, res: Response) => {
  const employee = await employeeService.getEmployeeById(req.tenantId!, req.params.id);
  sendSuccess(res, employee);
});

export const updateEmployeeHandler = asyncHandler(async (req: Request, res: Response) => {
  const employee = await employeeService.updateEmployee(req.tenantId!, req.params.id, req.body, photoUrlFor(req));
  sendSuccess(res, employee);
});

export const deleteEmployeeHandler = asyncHandler(async (req: Request, res: Response) => {
  await employeeService.deleteEmployee(req.tenantId!, req.params.id);
  sendSuccess(res, { message: "Employee deleted" });
});

export const exportEmployeesHandler = asyncHandler(async (req: Request, res: Response) => {
  const csv = await employeeService.exportEmployeesToCsv(req.tenantId!);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="employees-${Date.now()}.csv"`);
  res.send(csv);
});

export const importEmployeesHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw ApiError.badRequest("CSV fayl talab qilinadi");
  }
  const results = await employeeService.importEmployeesFromCsv(req.tenantId!, req.file.buffer.toString("utf-8"));
  sendSuccess(res, results);
});
