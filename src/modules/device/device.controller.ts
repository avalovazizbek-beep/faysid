import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendCreated, sendSuccess } from "../../common/api-response";
import * as deviceService from "./device.service";

export const createDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const device = await deviceService.createDevice(req.tenantId!, req.body);
  sendCreated(res, device);
});

export const listDevicesHandler = asyncHandler(async (req: Request, res: Response) => {
  const devices = await deviceService.listDevices(req.tenantId!);
  sendSuccess(res, devices);
});

export const getDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const device = await deviceService.getOwnedDevice(req.tenantId!, req.params.id);
  sendSuccess(res, device);
});

export const updateDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const device = await deviceService.updateDevice(req.tenantId!, req.params.id, req.body);
  sendSuccess(res, device);
});

export const deleteDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  await deviceService.deleteDevice(req.tenantId!, req.params.id);
  sendSuccess(res, { message: "Device deleted" });
});

export const heartbeatDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const device = await deviceService.heartbeat(req.tenantId!, req.params.id);
  sendSuccess(res, device);
});

export const reconnectDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const device = await deviceService.reconnect(req.tenantId!, req.params.id);
  sendSuccess(res, device);
});

export const restartDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await deviceService.restart(req.tenantId!, req.params.id, req.user?.sub);
  sendSuccess(res, result);
});

export const syncDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await deviceService.sync(req.tenantId!, req.params.id);
  sendSuccess(res, result);
});

export const listDeviceSyncsHandler = asyncHandler(async (req: Request, res: Response) => {
  const syncs = await deviceService.listDeviceSyncs(req.tenantId!, req.params.id);
  sendSuccess(res, syncs);
});

export const listEmployeesToSyncHandler = asyncHandler(async (req: Request, res: Response) => {
  const employees = await deviceService.listEmployeesToSync(req.tenantId!, req.params.id);
  sendSuccess(res, employees);
});

export const ackEmployeeSyncHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, errorMessage } = req.body;
  const result = await deviceService.ackEmployeeSync(
    req.tenantId!,
    req.params.id,
    req.params.employeeId,
    status,
    errorMessage,
  );
  sendSuccess(res, result);
});
