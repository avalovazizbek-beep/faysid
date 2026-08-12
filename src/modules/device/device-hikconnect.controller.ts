import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as deviceHikConnectService from "./device-hikconnect.service";

export const getHikConnectSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const settings = await deviceHikConnectService.getHikConnectSettings(req.tenantId!);
  sendSuccess(res, settings);
});

export const updateHikConnectSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const settings = await deviceHikConnectService.updateHikConnectSettings(req.tenantId!, req.body);
  sendSuccess(res, settings);
});

export const testHikConnectHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await deviceHikConnectService.testHikConnect(req.tenantId!);
  sendSuccess(res, result);
});

export const listCloudDevicesHandler = asyncHandler(async (req: Request, res: Response) => {
  const devices = await deviceHikConnectService.listCloudDevices(req.tenantId!);
  sendSuccess(res, devices);
});

export const connectCloudDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const device = await deviceHikConnectService.connectCloudDevice(req.tenantId!, req.params.hikConnectDeviceId, req.body.name);
  sendSuccess(res, device);
});
