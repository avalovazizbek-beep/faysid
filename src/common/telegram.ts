import { env } from "../config/env";
import { logger } from "../config/logger";

/**
 * Sends a document to a Telegram chat via the Bot API's sendDocument endpoint.
 * Uses Node's built-in fetch/FormData/Blob — no telegram SDK dependency needed
 * for a single-endpoint integration like this.
 */
export async function sendTelegramDocument(
  chatId: string,
  buffer: Buffer,
  filename: string,
  caption?: string,
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    logger.warn(`Telegram: TELEGRAM_BOT_TOKEN not set — skipping send of ${filename} to chat ${chatId}`);
    return;
  }

  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([buffer]), filename);

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram sendDocument failed (${response.status}): ${body}`);
  }
}
