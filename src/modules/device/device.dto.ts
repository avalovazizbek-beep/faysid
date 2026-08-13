import { z } from "zod";
import { DeviceVendor, DeviceAttendanceDirection } from "@prisma/client";

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
  // For setups with a separate entry-only/exit-only terminal instead of one
  // device at a single door. Defaults to inferring direction automatically.
  attendanceDirection: z.nativeEnum(DeviceAttendanceDirection).optional(),
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
  attendanceDirection: z.nativeEnum(DeviceAttendanceDirection).optional(),
  // Telegram group this device's check-in/check-out events are sent to —
  // null clears it (falls back to the organization's default chat).
  telegramChatId: z.string().max(64).nullable().optional(),
  // "HH:mm" (Asia/Tashkent) daily report send time for this device's own
  // telegramChatId — null clears it (falls back to "18:00", see jobs/daily-report.job.ts).
  dailyReportTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm formatida bo'lishi kerak")
    .nullable()
    .optional(),
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
