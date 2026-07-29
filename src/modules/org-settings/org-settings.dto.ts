import { z } from "zod";

export const updateOrgSettingsSchema = z.object({
  telegramChatId: z.string().max(64).nullable().optional(),
});
export type UpdateOrgSettingsDto = z.infer<typeof updateOrgSettingsSchema>;
