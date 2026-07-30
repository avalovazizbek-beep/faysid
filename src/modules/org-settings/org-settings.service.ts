import { randomBytes } from "node:crypto";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { env } from "../../config/env";
import { encryptSecret, decryptSecret } from "../../common/secret-crypto";
import * as bot from "../telegram-onboarding/telegram-bot-api";
import { ensureTodaysRegistrationCode } from "../telegram-onboarding/registration-code";
import { UpdateOrgSettingsDto } from "./org-settings.dto";

function webhookUrl(organizationId: string): string | null {
  if (!env.PUBLIC_BASE_URL) return null;
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/telegram-webhook/${organizationId}`;
}

export async function getOrgSettings(organizationId: string) {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { telegramChatId: true, telegramBotTokenEnc: true },
  });
  if (!organization) {
    throw ApiError.notFound("Organization not found");
  }

  const hasTelegramBot = Boolean(organization.telegramBotTokenEnc);
  const telegramRegistrationCode = hasTelegramBot ? await ensureTodaysRegistrationCode(organizationId) : null;

  return {
    telegramChatId: organization.telegramChatId,
    hasTelegramBot,
    telegramRegistrationCode,
  };
}

export async function updateOrgSettings(organizationId: string, dto: UpdateOrgSettingsDto) {
  const data: { telegramChatId?: string | null } = {};
  if (dto.telegramChatId !== undefined) {
    data.telegramChatId = dto.telegramChatId;
  }

  if (dto.telegramBotToken !== undefined) {
    if (dto.telegramBotToken) {
      const token = dto.telegramBotToken.trim();
      const secret = randomBytes(24).toString("hex");
      const url = webhookUrl(organizationId);
      if (url) {
        try {
          await bot.setWebhook(token, url, secret);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw ApiError.badRequest(`Telegram bot tokenini tekshirishda xatolik: ${message}`);
        }
      }
      await prisma.organization.update({
        where: { id: organizationId },
        data: { ...data, telegramBotTokenEnc: encryptSecret(token), telegramWebhookSecret: secret },
      });
      await ensureTodaysRegistrationCode(organizationId);
    } else {
      const existing = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { telegramBotTokenEnc: true },
      });
      if (existing?.telegramBotTokenEnc) {
        try {
          await bot.deleteWebhook(decryptSecret(existing.telegramBotTokenEnc));
        } catch {
          // Best-effort — token may already be invalid/revoked; still clear our side.
        }
      }
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          ...data,
          telegramBotTokenEnc: null,
          telegramWebhookSecret: null,
          telegramRegistrationCode: null,
          telegramRegistrationCodeDate: null,
        },
      });
    }
  } else if (Object.keys(data).length > 0) {
    await prisma.organization.update({ where: { id: organizationId }, data });
  }

  return getOrgSettings(organizationId);
}
