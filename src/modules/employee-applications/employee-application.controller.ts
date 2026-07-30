import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as applicationService from "./employee-application.service";

export const listApplicationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const applications = await applicationService.listApplications(req.tenantId!, req.query as Record<string, string>);
  sendSuccess(res, applications);
});

export const approveApplicationHandler = asyncHandler(async (req: Request, res: Response) => {
  const employee = await applicationService.approveApplication(
    req.tenantId!,
    req.params.id,
    req.body.employeeCode,
    req.user?.sub,
  );
  sendSuccess(res, employee);
});

export const rejectApplicationHandler = asyncHandler(async (req: Request, res: Response) => {
  const application = await applicationService.rejectApplication(req.tenantId!, req.params.id, req.user?.sub);
  sendSuccess(res, application);
});
