import { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { handleUpdate, TelegramUpdate } from "./telegram-onboarding.service";

export async function handleTelegramWebhook(req: Request, res: Response): Promise<void> {
  // Ack immediately — Telegram retries aggressively on anything but a fast 200.
  res.status(200).json({ ok: true });

  const organizationId = req.params.organizationId;
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { telegramWebhookSecret: true },
    });
    if (!org?.telegramWebhookSecret) return;

    const providedSecret = req.header("x-telegram-bot-api-secret-token");
    if (providedSecret !== org.telegramWebhookSecret) {
      logger.warn(`Telegram webhook: secret mismatch for organization ${organizationId}`);
      return;
    }

    await handleUpdate(organizationId, req.body as TelegramUpdate);
  } catch (error) {
    logger.error(`Telegram webhook processing failed for organization ${organizationId}: ${error}`);
  }
}
