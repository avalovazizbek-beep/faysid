import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as platformSettingsService from "./platform-settings.service";

export const getPlatformSettingsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await platformSettingsService.getPlatformSettings();
  sendSuccess(res, settings);
});

export const updatePlatformSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const settings = await platformSettingsService.updatePlatformSettings(req.body);
  sendSuccess(res, settings);
});

export const testHikConnectHandler = asyncHandler(async (_req: Request, res: Response) => {
  const result = await platformSettingsService.testHikConnect();
  sendSuccess(res, result);
});
