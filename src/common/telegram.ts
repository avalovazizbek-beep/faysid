import { env } from "../config/env";
import { logger } from "../config/logger";
import { prisma } from "../config/prisma";
import { decryptSecret } from "./secret-crypto";

/**
 * Resolves which bot token to send with for a given organization: its own
 * configured "main" bot (Organization.telegramNotifyBotTokenEnc — set via
 * the Security page, used for real-time notifications/daily reports/the
 * interactive command menu) when set, else the single platform-wide
 * env.TELEGRAM_BOT_TOKEN. Returns null if neither is configured — callers
 * treat that as "nothing to send with" and skip, same tolerance as before.
 */
export async function resolveNotifyBotToken(organizationId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { telegramNotifyBotTokenEnc: true },
  });
  if (org?.telegramNotifyBotTokenEnc) return decryptSecret(org.telegramNotifyBotTokenEnc);
  return env.TELEGRAM_BOT_TOKEN ?? null;
}

/**
 * Sends a document to a Telegram chat via the Bot API's sendDocument endpoint.
 * Uses Node's built-in fetch/FormData/Blob — no telegram SDK dependency needed
 * for a single-endpoint integration like this.
 */
export async function sendTelegramDocument(
  token: string,
  chatId: string,
  buffer: Buffer,
  filename: string,
  caption?: string,
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([buffer]), filename);

  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram sendDocument failed (${response.status}): ${body}`);
  }
}

/**
 * Sends a photo (with an inline preview, unlike sendDocument) — used for the
 * real-time check-in/check-out notification showing the employee's photo.
 */
export async function sendTelegramPhoto(token: string, chatId: string, buffer: Buffer, caption?: string): Promise<void> {
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption);
  form.append("photo", new Blob([buffer]), "photo.jpg");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram sendPhoto failed (${response.status}): ${body}`);
  }
}

/**
 * Sends a photo by URL — Telegram fetches it itself, so no download/re-upload
 * round-trip is needed. Used for a device event's live verification snapshot
 * (a Hik-Connect cloud URL), as opposed to sendTelegramPhoto()'s buffer upload
 * (used for an employee's own stored profile photo).
 */
export async function sendTelegramPhotoByUrl(token: string, chatId: string, photoUrl: string, caption?: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram sendPhoto (by url) failed (${response.status}): ${body}`);
  }
}

/** Text-only notification — used when the employee has no stored photo. */
export async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed (${response.status}): ${body}`);
  }
}

/** Logs and no-ops in the (rare) case no bot token is configured at all — the shared "give up" path for every send call site. */
export function warnNoBotToken(context: string, chatId: string): void {
  logger.warn(`Telegram: no bot token configured — skipping ${context} to chat ${chatId}`);
}
