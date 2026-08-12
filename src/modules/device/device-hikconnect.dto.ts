import { z } from "zod";

export const updateHikConnectSettingsSchema = z.object({
  hikConnectAppKey: z.string().max(200).nullable().optional(),
  // A non-empty string sets/replaces the secret; undefined leaves it untouched.
  hikConnectAppSecret: z.string().max(500).optional(),
  hikConnectRegion: z.string().max(50).nullable().optional(),
});
export type UpdateHikConnectSettingsDto = z.infer<typeof updateHikConnectSettingsSchema>;

export const cloudDeviceParamSchema = z.object({
  hikConnectDeviceId: z.string().min(1).max(100),
});

export const connectCloudDeviceSchema = z.object({
  name: z.string().max(150).optional(),
});
export type ConnectCloudDeviceDto = z.infer<typeof connectCloudDeviceSchema>;
