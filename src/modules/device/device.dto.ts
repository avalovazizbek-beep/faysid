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
});
export type UpdateDeviceDto = z.infer<typeof updateDeviceSchema>;

export const deviceIdParamSchema = z.object({
  id: z.string().uuid(),
});
