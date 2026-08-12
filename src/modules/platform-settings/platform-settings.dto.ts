import { z } from "zod";

export const updatePlatformSettingsSchema = z.object({
  hikConnectAppKey: z.string().max(200).nullable().optional(),
  hikConnectAppSecret: z.string().max(200).nullable().optional(),
  hikConnectRegion: z.string().max(50).nullable().optional(),
});
export type UpdatePlatformSettingsDto = z.infer<typeof updatePlatformSettingsSchema>;
