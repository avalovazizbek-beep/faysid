import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as payrollService from "./payroll.service";

export const generatePayrollHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await payrollService.generatePayroll(req.tenantId!, req.body, req.user!.sub);
  sendSuccess(res, result);
});

export const listPayrollHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, pagination } = await payrollService.listPayroll(req.tenantId!, req.query as Record<string, string>);
  sendSuccess(res, items, 200, pagination);
});

export const updatePayrollHandler = asyncHandler(async (req: Request, res: Response) => {
  const payroll = await payrollService.updatePayroll(req.tenantId!, req.params.id, req.body);
  sendSuccess(res, payroll);
});

export const finalizePayrollHandler = asyncHandler(async (req: Request, res: Response) => {
  const payroll = await payrollService.finalizePayroll(req.tenantId!, req.params.id, req.user!.sub);
  sendSuccess(res, payroll);
});
