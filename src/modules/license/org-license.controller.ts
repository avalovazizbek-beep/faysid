import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as licenseService from "./license.service";

export const getOrgLicenseStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const status = await licenseService.getLicenseStatusForOrg(req.tenantId!);
  sendSuccess(res, status);
});

export const activateOrgLicenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const organization = await licenseService.activateLicenseForOrg(req.tenantId!, req.body, {
    userId: req.user!.sub,
    ipAddress: req.ip ?? null,
  });
  sendSuccess(res, organization);
});
