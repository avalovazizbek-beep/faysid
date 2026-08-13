import { randomBytes } from "node:crypto";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { env } from "../../config/env";
import { encryptSecret, decryptSecret } from "../../common/secret-crypto";
import * as bot from "../telegram-onboarding/telegram-bot-api";
import { ensureTodaysRegistrationCode } from "../telegram-onboarding/registration-code";
import { registerNotifyBotWebhook } from "../telegram-bot/telegram-bot.service";
import { UpdateOrgSettingsDto } from "./org-settings.dto";

function webhookUrl(organizationId: string): string | null {
  if (!env.PUBLIC_BASE_URL) return null;
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/telegram-webhook/${organizationId}`;
}

export async function getOrgSettings(organizationId: string) {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { telegramChatId: true, telegramBotTokenEnc: true, telegramNotifyBotTokenEnc: true },
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
    hasTelegramNotifyBot: Boolean(organization.telegramNotifyBotTokenEnc),
  };
}

/** Saves (or clears) the per-organization employee self-registration bot token, registering/tearing down its dedicated webhook. */
async function applyOnboardingBotToken(organizationId: string, rawToken: string | null): Promise<void> {
  if (rawToken) {
    const token = rawToken.trim();
    const secret = randomBytes(24).toString("hex");
    const url = webhookUrl(organizationId);
    // This bot only works via webhook — saving a token without registering
    // one would silently produce a bot that never responds to anything, so
    // fail loudly here rather than quietly persisting a useless token.
    if (!url) {
      throw ApiError.badRequest(
        "Serverda PUBLIC_BASE_URL sozlanmagan — Telegram webhook'ni ro'yxatdan o'tkazib bo'lmaydi. Server .env fayliga PUBLIC_BASE_URL qo'shing va serverni qayta ishga tushiring.",
      );
    }
    try {
      await bot.setWebhook(token, url, secret);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw ApiError.badRequest(`Telegram bot tokenini tekshirishda xatolik: ${message}`);
    }
    await prisma.organization.update({
      where: { id: organizationId },
      data: { telegramBotTokenEnc: encryptSecret(token), telegramWebhookSecret: secret },
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
        telegramBotTokenEnc: null,
        telegramWebhookSecret: null,
        telegramRegistrationCode: null,
        telegramRegistrationCodeDate: null,
      },
    });
  }
}

/**
 * Saves (or clears) the organization's own "main" notify-bot token (real-time
 * alerts/daily reports/interactive menu — see telegram-bot/telegram-bot.service.ts).
 * Unlike the onboarding bot above, this shares one platform-wide webhook URL
 * across every organization's notify-bot token (registerNotifyBotWebhook),
 * so there's no per-organization webhook path to build here.
 */
async function applyNotifyBotToken(organizationId: string, rawToken: string | null): Promise<void> {
  if (rawToken) {
    const token = rawToken.trim();
    try {
      await registerNotifyBotWebhook(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw ApiError.badRequest(`Telegram bot tokenini tekshirishda xatolik: ${message}`);
    }
    await prisma.organization.update({ where: { id: organizationId }, data: { telegramNotifyBotTokenEnc: encryptSecret(token) } });
  } else {
    const existing = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { telegramNotifyBotTokenEnc: true },
    });
    if (existing?.telegramNotifyBotTokenEnc) {
      try {
        await bot.deleteWebhook(decryptSecret(existing.telegramNotifyBotTokenEnc));
      } catch {
        // Best-effort — token may already be invalid/revoked; still clear our side.
      }
    }
    await prisma.organization.update({ where: { id: organizationId }, data: { telegramNotifyBotTokenEnc: null } });
  }
}

export async function updateOrgSettings(organizationId: string, dto: UpdateOrgSettingsDto) {
  if (dto.telegramChatId !== undefined) {
    await prisma.organization.update({ where: { id: organizationId }, data: { telegramChatId: dto.telegramChatId } });
  }
  if (dto.telegramBotToken !== undefined) {
    await applyOnboardingBotToken(organizationId, dto.telegramBotToken);
  }
  if (dto.telegramNotifyBotToken !== undefined) {
    await applyNotifyBotToken(organizationId, dto.telegramNotifyBotToken);
  }

  return getOrgSettings(organizationId);
}
