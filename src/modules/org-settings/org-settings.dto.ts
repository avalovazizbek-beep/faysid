import { z } from "zod";

export const updateOrgSettingsSchema = z.object({
  telegramChatId: z.string().max(64).nullable().optional(),
  // Onboarding-bot token: a non-empty string sets/replaces it, "" or null clears it.
  telegramBotToken: z.string().max(200).nullable().optional(),
  // Hik-Connect / Hikvision Open Platform cloud credentials.
  hikConnectAppKey: z.string().max(200).nullable().optional(),
  hikConnectAppSecret: z.string().max(200).nullable().optional(),
  hikConnectApiBaseUrl: z.string().max(300).nullable().optional(),
});
export type UpdateOrgSettingsDto = z.infer<typeof updateOrgSettingsSchema>;
