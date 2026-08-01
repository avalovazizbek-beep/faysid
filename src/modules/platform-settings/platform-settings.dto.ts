import { z } from "zod";

export const updatePlatformSettingsSchema = z.object({
  hikConnectAppKey: z.string().max(200).nullable().optional(),
  hikConnectAppSecret: z.string().max(200).nullable().optional(),
  hikConnectApiBaseUrl: z.string().max(300).nullable().optional(),
});
export type UpdatePlatformSettingsDto = z.infer<typeof updatePlatformSettingsSchema>;
