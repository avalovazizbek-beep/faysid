import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendCreated, sendSuccess } from "../../common/api-response";
import * as licenseService from "./license.service";

function actorFrom(req: Request) {
  return { userId: req.user!.sub, ipAddress: req.ip ?? null };
}

export const generateLicenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const license = await licenseService.generateLicense(req.body, actorFrom(req));
  sendCreated(res, license);
});

export const renewLicenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const license = await licenseService.renewLicense(req.params.id, req.body, actorFrom(req));
  sendCreated(res, license);
});

export const disableLicenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const license = await licenseService.disableLicense(req.params.id, actorFrom(req));
  sendSuccess(res, license);
});

export const deleteLicenseHandler = asyncHandler(async (req: Request, res: Response) => {
  await licenseService.deleteLicense(req.params.id, actorFrom(req));
  sendSuccess(res, { message: "License deleted" });
});

export const transferLicenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const license = await licenseService.transferLicense(req.params.id, req.body, actorFrom(req));
  sendSuccess(res, license);
});

export const listLicensesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, pagination } = await licenseService.listLicenses(req.query as Record<string, string>);
  sendSuccess(res, items, 200, pagination);
});
