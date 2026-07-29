import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as orgSettingsService from "./org-settings.service";

export const getOrgSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const settings = await orgSettingsService.getOrgSettings(req.tenantId!);
  sendSuccess(res, settings);
});

export const updateOrgSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const settings = await orgSettingsService.updateOrgSettings(req.tenantId!, req.body);
  sendSuccess(res, settings);
});
