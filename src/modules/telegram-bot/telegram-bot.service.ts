import { randomBytes } from "node:crypto";
import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { env } from "../../config/env";
import { resolveNotifyBotToken, sendTelegramDocument } from "../../common/telegram";
import * as bot from "../telegram-onboarding/telegram-bot-api";
import { getDailyAttendanceReport, dailyReportToExcel, dailyReportToPdf } from "../reports/daily-report.service";
import { getRangeAttendanceReport, rangeReportToExcel, rangeReportToPdf } from "../reports/range-report.service";
import {
  resolveChatScope,
  getTodaySummary,
  getArrivedToday,
  getAbsentToday,
  getLateToday,
  type ChatScope,
  type NamedTime,
} from "./attendance-queries";

/**
 * Interactive command menu for the "main" notification bot — each
 * organization can configure its own token (Organization.telegramNotifyBotTokenEnc,
 * set via the Security page) or fall back to the single platform-wide
 * env.TELEGRAM_BOT_TOKEN (see common/telegram.ts's resolveNotifyBotToken()).
 * A chat's scope (which organization, and optionally which one device) is
 * resolved by matching its chat_id against Device.telegramChatId first,
 * then Organization.telegramChatId — the same binding used to route
 * real-time attendance notifications, so a command typed in a device's own
 * group answers about just that device. Every configured bot token shares
 * the same webhook URL/secret (see registerNotifyBotWebhook below) — which
 * organization an update belongs to is resolved from its chat_id, not from
 * which bot token Telegram delivered it through, so multiple organizations'
 * bots can safely share one endpoint.
 */

interface TelegramMessage {
  chat: { id: number };
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: { chat: { id: number } };
}

export interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

const MENU_KEYBOARD = [
  [{ text: "📊 Bugun", callback_data: "today" }],
  [{ text: "✅ Kelganlar", callback_data: "arrived" }],
  [{ text: "❌ Kelmaganlar", callback_data: "absent" }],
  [{ text: "⏱ Kechikkanlar", callback_data: "late" }],
  [{ text: "📅 Kunlik hisobot", callback_data: "daily_report" }],
  [{ text: "🗓 Haftalik hisobot", callback_data: "weekly_report" }],
  [{ text: "🗓 Oylik hisobot", callback_data: "monthly_report" }],
];

const BOT_COMMANDS = [
  { command: "menu", description: "Menyuni ko'rsatish" },
  { command: "bugun", description: "Bugungi holat (kelgan/kelmagan/kechikkan soni)" },
  { command: "kelganlar", description: "Bugun kelganlar ro'yxati" },
  { command: "kelmaganlar", description: "Bugun kelmaganlar ro'yxati" },
  { command: "kechikkanlar", description: "Bugun kechikkanlar ro'yxati" },
  { command: "kunlik", description: "Bugungi kunlik hisobotni yuborish (Excel+PDF)" },
  { command: "haftalik", description: "Shu haftalik hisobotni yuborish" },
  { command: "oylik", description: "Shu oylik hisobotni yuborish" },
];

async function notify(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logger.warn(`Telegram bot: ${label} failed: ${error}`);
  }
}

/** Renders a Date as Asia/Tashkent (UTC+5, no DST) wall-clock "HH:mm". */
function formatTime(value: Date | null): string {
  if (!value) return "-";
  const tashkent = new Date(value.getTime() + 5 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(tashkent.getUTCHours())}:${pad(tashkent.getUTCMinutes())}`;
}

const CHUNK_LIMIT = 3500;

async function sendChunked(token: string, chatId: string, lines: string[]): Promise<void> {
  let chunk: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (chunk.length > 0 && length + line.length + 1 > CHUNK_LIMIT) {
      await notify("sendMessage (chunk)", () => bot.sendMessage(token, chatId, chunk.join("\n")));
      chunk = [];
      length = 0;
    }
    chunk.push(line);
    length += line.length + 1;
  }
  if (chunk.length > 0) {
    await notify("sendMessage (chunk)", () => bot.sendMessage(token, chatId, chunk.join("\n")));
  }
}

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }
  if (update.message) {
    await handleMessage(update.message);
  }
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const chatId = String(message.chat.id);
  const command = (message.text ?? "").trim().toLowerCase().split(/[\s@]/)[0];
  if (!command.startsWith("/")) return;

  const scope = await resolveChatScope(chatId);
  if (!scope) {
    // Chat isn't bound to any organization/device yet — respond with the
    // platform default bot (if any) rather than nothing, since there's no
    // organization to resolve an org-specific token from.
    if ((command === "/start" || command === "/menu") && env.TELEGRAM_BOT_TOKEN) {
      await notify("sendMessage", () =>
        bot.sendMessage(
          env.TELEGRAM_BOT_TOKEN!,
          chatId,
          "Bu guruh hali FaceHub'ga ulanmagan. Qurilmalar sahifasida (yoki Xavfsizlik sahifasidagi Telegram sozlamalarida) shu guruhning chat ID'sini kiriting.",
        ),
      );
    }
    return;
  }

  const token = await resolveNotifyBotToken(scope.organizationId);
  if (!token) return;

  await dispatch(token, chatId, scope, command);
}

async function handleCallbackQuery(callback: TelegramCallbackQuery): Promise<void> {
  const chatId = callback.message ? String(callback.message.chat.id) : null;
  if (!chatId) return;

  const scope = await resolveChatScope(chatId);
  if (!scope) return;

  // Must answer with the same bot token whose inline keyboard this callback
  // belongs to — an unresolvable scope means no correct token, so there's
  // nothing valid to answer with.
  const token = await resolveNotifyBotToken(scope.organizationId);
  if (!token) return;

  await notify("answerCallbackQuery", () => bot.answerCallbackQuery(token, callback.id));

  const commandByCallback: Record<string, string> = {
    today: "/bugun",
    arrived: "/kelganlar",
    absent: "/kelmaganlar",
    late: "/kechikkanlar",
    daily_report: "/kunlik",
    weekly_report: "/haftalik",
    monthly_report: "/oylik",
  };
  const command = callback.data ? commandByCallback[callback.data] : undefined;
  if (command) await dispatch(token, chatId, scope, command);
}

async function dispatch(token: string, chatId: string, scope: ChatScope, command: string): Promise<void> {
  switch (command) {
    case "/start":
    case "/menu":
      await notify("sendMessage", () => bot.sendMessage(token, chatId, `📋 Menyu — ${scope.label}`, { inlineKeyboard: MENU_KEYBOARD }));
      break;
    case "/bugun":
      await sendTodaySummary(token, chatId, scope);
      break;
    case "/kelganlar":
      await sendArrivedList(token, chatId, scope);
      break;
    case "/kelmaganlar":
      await sendAbsentList(token, chatId, scope);
      break;
    case "/kechikkanlar":
      await sendLateList(token, chatId, scope);
      break;
    case "/kunlik":
      await sendDailyReport(token, chatId, scope);
      break;
    case "/haftalik":
      await sendRangeReport(token, chatId, scope, "weekly");
      break;
    case "/oylik":
      await sendRangeReport(token, chatId, scope, "monthly");
      break;
    default:
      break;
  }
}

async function sendTodaySummary(token: string, chatId: string, scope: ChatScope): Promise<void> {
  const summary = await getTodaySummary(scope);
  const text = [
    `📊 Bugungi holat — ${scope.label}`,
    "",
    `👥 Jami xodim: ${summary.total}`,
    `✅ Kelgan: ${summary.arrived}`,
    `❌ Kelmagan: ${summary.absent}`,
    `⏱ Kechikkan: ${summary.late}`,
  ].join("\n");
  await notify("sendMessage", () => bot.sendMessage(token, chatId, text));
}

function namedTimeLines(rows: NamedTime[]): string[] {
  return rows.map((r) => `${formatTime(r.time)}  ${r.fullName}`);
}

async function sendArrivedList(token: string, chatId: string, scope: ChatScope): Promise<void> {
  const rows = await getArrivedToday(scope);
  if (rows.length === 0) {
    await notify("sendMessage", () => bot.sendMessage(token, chatId, `✅ ${scope.label}: bugun hali hech kim kelmagan.`));
    return;
  }
  await sendChunked(token, chatId, [`✅ Kelganlar — ${scope.label} (${rows.length} kishi):`, ...namedTimeLines(rows)]);
}

async function sendAbsentList(token: string, chatId: string, scope: ChatScope): Promise<void> {
  const names = await getAbsentToday(scope);
  if (names.length === 0) {
    await notify("sendMessage", () => bot.sendMessage(token, chatId, `❌ ${scope.label}: bugun hamma keldi.`));
    return;
  }
  await sendChunked(token, chatId, [`❌ Kelmaganlar — ${scope.label} (${names.length} kishi):`, ...names.map((n) => `- ${n}`)]);
}

async function sendLateList(token: string, chatId: string, scope: ChatScope): Promise<void> {
  const rows = await getLateToday(scope);
  if (rows.length === 0) {
    await notify("sendMessage", () => bot.sendMessage(token, chatId, `⏱ ${scope.label}: bugun kechikkan yo'q.`));
    return;
  }
  await sendChunked(token, chatId, [`⏱ Kechikkanlar — ${scope.label} (${rows.length} kishi):`, ...namedTimeLines(rows)]);
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function sendDailyReport(token: string, chatId: string, scope: ChatScope): Promise<void> {
  const date = startOfToday();
  const dateLabel = date.toISOString().slice(0, 10);
  const rows = await getDailyAttendanceReport(scope.organizationId, date, scope.deviceId);
  const [excelBuffer, pdfBuffer] = await Promise.all([dailyReportToExcel(rows), dailyReportToPdf(rows, date)]);

  await notify("sendDocument", () =>
    sendTelegramDocument(token, chatId, excelBuffer, `Davomat_${dateLabel}.xlsx`, `${scope.label} — Kunlik hisobot ${dateLabel}`),
  );
  await notify("sendDocument", () => sendTelegramDocument(token, chatId, pdfBuffer, `Davomat_${dateLabel}.pdf`));
}

async function sendRangeReport(token: string, chatId: string, scope: ChatScope, range: "weekly" | "monthly"): Promise<void> {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start =
    range === "weekly"
      ? new Date(end.getTime() - 7 * 86_400_000)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const label = range === "weekly" ? "Haftalik" : "Oylik";
  const fileTag = end.toISOString().slice(0, 10);

  const rows = await getRangeAttendanceReport(scope.organizationId, start, end, scope.deviceId);
  const title = `${scope.label} — ${label} hisobot (${start.toISOString().slice(0, 10)} — ${fileTag})`;
  const [excelBuffer, pdfBuffer] = await Promise.all([rangeReportToExcel(rows, label), rangeReportToPdf(rows, title)]);

  await notify("sendDocument", () => sendTelegramDocument(token, chatId, excelBuffer, `${label}_${fileTag}.xlsx`, title));
  await notify("sendDocument", () => sendTelegramDocument(token, chatId, pdfBuffer, `${label}_${fileTag}.pdf`));
}

async function ensureWebhookSecret(): Promise<string> {
  const settings = await prisma.platformSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  if (settings.telegramBotWebhookSecret) return settings.telegramBotWebhookSecret;
  const secret = randomBytes(24).toString("hex");
  await prisma.platformSettings.update({ where: { id: 1 }, data: { telegramBotWebhookSecret: secret } });
  return secret;
}

/**
 * Registers one bot token's webhook + "/" command menu with Telegram —
 * reusable for both the platform-wide env.TELEGRAM_BOT_TOKEN (registered
 * once at server startup, see registerTelegramBotWebhook below) and any
 * organization's own notify-bot token (registered by org-settings.service.ts
 * when an admin saves it). Every token shares the same URL/secret — see the
 * module-level doc comment above for why that's safe. Throws on failure
 * (invalid token, Telegram API error) so the caller can surface it —
 * silently saving a token whose webhook never registered would just be a
 * bot that never responds, with no visible error.
 */
export async function registerNotifyBotWebhook(token: string): Promise<void> {
  if (!env.PUBLIC_BASE_URL) {
    throw new Error("PUBLIC_BASE_URL serverda sozlanmagan — Telegram webhook'ni ro'yxatdan o'tkazib bo'lmaydi");
  }
  const secret = await ensureWebhookSecret();
  const url = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/telegram-bot-webhook`;
  await bot.setWebhook(token, url, secret);
  await bot.setMyCommands(token, BOT_COMMANDS);
}

/**
 * Registers the platform-wide default bot's webhook on server startup — a
 * one-time (idempotent) setup, unlike an organization's own notify-bot
 * token, which registers when saved via org-settings. No-ops quietly if
 * TELEGRAM_BOT_TOKEN or PUBLIC_BASE_URL isn't configured, same tolerance as
 * the rest of the Telegram integration (this one bot is only a fallback —
 * organizations with their own token don't need it configured at all).
 */
export async function registerTelegramBotWebhook(): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !env.PUBLIC_BASE_URL) return;

  try {
    await registerNotifyBotWebhook(token);
    logger.info("Telegram bot webhook registered (platform default token)");
  } catch (error) {
    logger.warn(`Telegram bot webhook registration failed: ${error}`);
  }
}
