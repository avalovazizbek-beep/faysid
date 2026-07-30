import { z } from "zod";
import { DeviceVendor } from "@prisma/client";

export const createDeviceSchema = z.object({
  name: z.string().min(2).max(150),
  vendor: z.nativeEnum(DeviceVendor),
  ipAddress: z.string().min(1).max(45),
  port: z.coerce.number().int().min(1).max(65535).default(4370),
  macAddress: z.string().max(50).optional(),
  serialNumber: z.string().max(100).optional(),
  firmwareVersion: z.string().max(50).optional(),
  // Device's own local admin login (Hikvision ISAPI) — needed to actually push/pull
  // real data once the device is network-reachable. Optional: without it, sync/
  // reconnect fall back to their previous simulated/TCP-only behavior.
  isapiUsername: z.string().max(100).optional(),
  isapiPassword: z.string().max(200).optional(),
});
export type CreateDeviceDto = z.infer<typeof createDeviceSchema>;

export const updateDeviceSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  vendor: z.nativeEnum(DeviceVendor).optional(),
  ipAddress: z.string().min(1).max(45).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  macAddress: z.string().max(50).optional(),
  serialNumber: z.string().max(100).optional(),
  firmwareVersion: z.string().max(50).optional(),
  isapiUsername: z.string().max(100).optional(),
  isapiPassword: z.string().max(200).optional(),
});
export type UpdateDeviceDto = z.infer<typeof updateDeviceSchema>;

export const deviceIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const deviceEmployeeSyncParamSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
});

export const ackEmployeeSyncSchema = z.object({
  status: z.enum(["SYNCED", "FAILED"]),
  errorMessage: z.string().max(1000).optional(),
});
export type AckEmployeeSyncDto = z.infer<typeof ackEmployeeSyncSchema>;

export const deviceUserParamSchema = z.object({
  id: z.string().uuid(),
  personId: z.string().min(1).max(50),
});

export const importDeviceUserSchema = z.object({
  name: z.string().max(200).optional(),
});
export type ImportDeviceUserDto = z.infer<typeof importDeviceUserSchema>;
