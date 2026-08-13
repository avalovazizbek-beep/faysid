import { z } from "zod";

export const updateOrgSettingsSchema = z.object({
  telegramChatId: z.string().max(64).nullable().optional(),
  // Onboarding-bot token: a non-empty string sets/replaces it, "" or null clears it.
  telegramBotToken: z.string().max(200).nullable().optional(),
  // Main notify-bot token (real-time alerts/daily reports/interactive menu):
  // a non-empty string sets/replaces it, "" or null clears it (falls back to
  // the platform-wide env.TELEGRAM_BOT_TOKEN).
  telegramNotifyBotToken: z.string().max(200).nullable().optional(),
});
export type UpdateOrgSettingsDto = z.infer<typeof updateOrgSettingsSchema>;
