import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendCreated, sendSuccess } from "../../common/api-response";
import * as departmentService from "./department.service";

export const createDepartmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const department = await departmentService.createDepartment(req.tenantId!, req.body);
  sendCreated(res, department);
});

export const listDepartmentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const departments = await departmentService.listDepartments(req.tenantId!);
  sendSuccess(res, departments);
});

export const updateDepartmentHandler = asyncHandler(async (req: Request, res: Response) => {
  const department = await departmentService.updateDepartment(req.tenantId!, req.params.id, req.body);
  sendSuccess(res, department);
});

export const deleteDepartmentHandler = asyncHandler(async (req: Request, res: Response) => {
  await departmentService.deleteDepartment(req.tenantId!, req.params.id);
  sendSuccess(res, { message: "Department deleted" });
});
