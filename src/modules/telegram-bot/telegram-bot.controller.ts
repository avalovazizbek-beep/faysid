import { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { handleUpdate, TelegramUpdate } from "./telegram-bot.service";

export async function handleTelegramBotWebhook(req: Request, res: Response): Promise<void> {
  // Ack immediately — Telegram retries aggressively on anything but a fast 200.
  res.status(200).json({ ok: true });

  try {
    const settings = await prisma.platformSettings.findUnique({ where: { id: 1 } });
    if (!settings?.telegramBotWebhookSecret) return;

    const providedSecret = req.header("x-telegram-bot-api-secret-token");
    if (providedSecret !== settings.telegramBotWebhookSecret) {
      logger.warn("Telegram bot webhook: secret mismatch");
      return;
    }

    await handleUpdate(req.body as TelegramUpdate);
  } catch (error) {
    logger.error(`Telegram bot webhook processing failed: ${error}`);
  }
}
