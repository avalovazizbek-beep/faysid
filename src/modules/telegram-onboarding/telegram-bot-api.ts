/**
 * Minimal Telegram Bot API client for the per-organization onboarding bot.
 * Takes the bot token as a parameter (unlike common/telegram.ts, which uses
 * the single global TELEGRAM_BOT_TOKEN for the daily report) since each
 * organization configures its own bot. Native fetch/FormData — no SDK.
 */

interface ReplyKeyboardButton {
  text: string;
  request_contact?: boolean;
}

interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface SendMessageOptions {
  replyKeyboard?: ReplyKeyboardButton[][];
  inlineKeyboard?: InlineKeyboardButton[][];
  removeKeyboard?: boolean;
}

function apiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

export async function sendMessage(token: string, chatId: string, text: string, options?: SendMessageOptions): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };

  if (options?.replyKeyboard) {
    body.reply_markup = { keyboard: options.replyKeyboard, resize_keyboard: true, one_time_keyboard: true };
  } else if (options?.inlineKeyboard) {
    body.reply_markup = { inline_keyboard: options.inlineKeyboard };
  } else if (options?.removeKeyboard) {
    body.reply_markup = { remove_keyboard: true };
  }

  const response = await fetch(apiUrl(token, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed (${response.status}): ${errorText}`);
  }
}

export async function answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<void> {
  await fetch(apiUrl(token, "answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

/** Resolves a Telegram file_id to its downloadable file_path. */
export async function getFilePath(token: string, fileId: string): Promise<string> {
  const response = await fetch(apiUrl(token, "getFile") + `?file_id=${encodeURIComponent(fileId)}`);
  if (!response.ok) {
    throw new Error(`Telegram getFile failed (${response.status})`);
  }
  const data = (await response.json()) as { result?: { file_path?: string } };
  if (!data.result?.file_path) {
    throw new Error("Telegram getFile returned no file_path");
  }
  return data.result.file_path;
}

export async function downloadFile(token: string, filePath: string): Promise<Buffer> {
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!response.ok) {
    throw new Error(`Telegram file download failed (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function setWebhook(token: string, url: string, secretToken: string): Promise<void> {
  const response = await fetch(apiUrl(token, "setWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secretToken }),
  });
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram setWebhook failed: ${data.description ?? response.status}`);
  }
}

export async function deleteWebhook(token: string): Promise<void> {
  await fetch(apiUrl(token, "deleteWebhook"), { method: "POST" });
}

export async function getBotUsername(token: string): Promise<string | undefined> {
  const response = await fetch(apiUrl(token, "getMe"));
  if (!response.ok) return undefined;
  const data = (await response.json().catch(() => ({}))) as { result?: { username?: string } };
  return data.result?.username;
}
