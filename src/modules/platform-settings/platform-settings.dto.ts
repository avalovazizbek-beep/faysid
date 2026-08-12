import { z } from "zod";

export const updatePlatformSettingsSchema = z.object({
  hikConnectAppKey: z.string().max(200).nullable().optional(),
  hikConnectAppSecret: z.string().max(200).nullable().optional(),
  hikConnectRegion: z.string().max(50).nullable().optional(),
});
export type UpdatePlatformSettingsDto = z.infer<typeof updatePlatformSettingsSchema>;

export const hikConnectDeviceParamSchema = z.object({
  hikConnectDeviceId: z.string().min(1).max(100),
});

export const assignHikConnectDeviceSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().max(150).optional(),
});
export type AssignHikConnectDeviceDto = z.infer<typeof assignHikConnectDeviceSchema>;
