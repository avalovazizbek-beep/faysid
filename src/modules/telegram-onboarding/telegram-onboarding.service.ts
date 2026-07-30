import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { decryptSecret } from "../../common/secret-crypto";
import * as bot from "./telegram-bot-api";

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  from?: { id: number; username?: string };
  text?: string;
  contact?: { phone_number: string };
  photo?: { file_id: string }[];
}

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: { chat: { id: number } };
  from?: { id: number; username?: string };
}

export interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

const STEP = {
  AWAITING_CONTACT: "AWAITING_CONTACT",
  AWAITING_CODE: "AWAITING_CODE",
  AWAITING_NAME: "AWAITING_NAME",
  AWAITING_PHOTO: "AWAITING_PHOTO",
  AWAITING_CONFIRM: "AWAITING_CONFIRM",
} as const;

async function getBotToken(organizationId: string): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { telegramBotTokenEnc: true },
  });
  if (!org?.telegramBotTokenEnc) return null;
  return decryptSecret(org.telegramBotTokenEnc);
}

function saveApplicationPhoto(buffer: Buffer): string {
  const dir = path.join(__dirname, "..", "..", "..", "uploads", "applications");
  mkdirSync(dir, { recursive: true });
  const filename = `${randomUUID()}.jpg`;
  writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/applications/${filename}`;
}

async function resetSession(organizationId: string, chatId: string): Promise<void> {
  await prisma.telegramOnboardingSession.upsert({
    where: { organizationId_chatId: { organizationId, chatId } },
    create: { organizationId, chatId, step: STEP.AWAITING_CONTACT },
    update: { step: STEP.AWAITING_CONTACT, phone: null, fullName: null, photoFileId: null },
  });
}

export async function handleUpdate(organizationId: string, update: TelegramUpdate): Promise<void> {
  const token = await getBotToken(organizationId);
  if (!token) {
    logger.warn(`Telegram onboarding: no bot token configured for organization ${organizationId}`);
    return;
  }

  if (update.callback_query) {
    await handleCallbackQuery(organizationId, token, update.callback_query);
    return;
  }
  if (update.message) {
    await handleMessage(organizationId, token, update.message);
  }
}

async function handleMessage(organizationId: string, token: string, message: TelegramMessage): Promise<void> {
  const chatId = String(message.chat.id);

  if (message.text === "/start") {
    await resetSession(organizationId, chatId);
    await notify("sendMessage", () =>
      bot.sendMessage(token, chatId, "Xush kelibsiz! Ro'yxatdan o'tish uchun kontaktingizni ulashing.", {
        replyKeyboard: [[{ text: "📱 Kontaktni ulashish", request_contact: true }]],
      }),
    );
    return;
  }

  const session = await prisma.telegramOnboardingSession.findUnique({
    where: { organizationId_chatId: { organizationId, chatId } },
  });
  if (!session) {
    await notify("sendMessage", () => bot.sendMessage(token, chatId, "Ro'yxatdan o'tishni boshlash uchun /start bosing."));
    return;
  }

  if (session.step === STEP.AWAITING_CONTACT) {
    if (!message.contact) {
      await notify("sendMessage", () =>
        bot.sendMessage(token, chatId, "Iltimos, pastdagi tugma orqali kontaktingizni ulashing.", {
          replyKeyboard: [[{ text: "📱 Kontaktni ulashish", request_contact: true }]],
        }),
      );
      return;
    }
    await prisma.telegramOnboardingSession.update({
      where: { organizationId_chatId: { organizationId, chatId } },
      data: {
        step: STEP.AWAITING_CODE,
        phone: message.contact.phone_number,
        telegramUserId: message.from ? String(message.from.id) : null,
        telegramUsername: message.from?.username ?? null,
      },
    });
    await notify("sendMessage", () =>
      bot.sendMessage(token, chatId, "Rahmat! Endi tashkilotingiz bergan ro'yxatdan o'tish kodini kiriting.", {
        removeKeyboard: true,
      }),
    );
    return;
  }

  if (session.step === STEP.AWAITING_CODE) {
    const enteredCode = (message.text ?? "").trim().toLowerCase();
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { telegramRegistrationCode: true, telegramRegistrationCodeDate: true },
    });
    const today = new Date().toISOString().slice(0, 10);
    const codeDate = org?.telegramRegistrationCodeDate?.toISOString().slice(0, 10);
    const validCode = org?.telegramRegistrationCode?.toLowerCase();

    if (!validCode || codeDate !== today || enteredCode !== validCode) {
      await notify("sendMessage", () => bot.sendMessage(token, chatId, "Noto'g'ri kod. Qaytadan urinib ko'ring."));
      return;
    }

    await prisma.telegramOnboardingSession.update({
      where: { organizationId_chatId: { organizationId, chatId } },
      data: { step: STEP.AWAITING_NAME },
    });
    await notify("sendMessage", () =>
      bot.sendMessage(token, chatId, "Kod to'g'ri! Ism va familiyangizni to'liq kiriting (masalan: Ali Valiyev)."),
    );
    return;
  }

  if (session.step === STEP.AWAITING_NAME) {
    const fullName = (message.text ?? "").trim();
    if (fullName.length < 2) {
      await notify("sendMessage", () => bot.sendMessage(token, chatId, "Iltimos, ism va familiyangizni to'liq kiriting."));
      return;
    }
    await prisma.telegramOnboardingSession.update({
      where: { organizationId_chatId: { organizationId, chatId } },
      data: { step: STEP.AWAITING_PHOTO, fullName },
    });
    await notify("sendMessage", () =>
      bot.sendMessage(token, chatId, "Endi rasmingizni yuboring (aniq va yorug' joyda tushirilgan bo'lsin)."),
    );
    return;
  }

  if (session.step === STEP.AWAITING_PHOTO) {
    const photos = message.photo;
    if (!photos || photos.length === 0) {
      await notify("sendMessage", () => bot.sendMessage(token, chatId, "Iltimos, rasm (surat) yuboring."));
      return;
    }
    const largest = photos[photos.length - 1];
    await prisma.telegramOnboardingSession.update({
      where: { organizationId_chatId: { organizationId, chatId } },
      data: { step: STEP.AWAITING_CONFIRM, photoFileId: largest.file_id },
    });
    await notify("sendMessage", () =>
      bot.sendMessage(
        token,
        chatId,
        `Tekshiring:\n\nIsm: ${session.fullName}\nTelefon: ${session.phone}\nRasm: qabul qilindi\n\nYuborishni tasdiqlaysizmi?`,
        {
          inlineKeyboard: [
            [
              { text: "✅ Yuborish", callback_data: "submit" },
              { text: "❌ Bekor qilish", callback_data: "cancel" },
            ],
          ],
        },
      ),
    );
    return;
  }

  if (session.step === STEP.AWAITING_CONFIRM) {
    await notify("sendMessage", () =>
      bot.sendMessage(token, chatId, "Iltimos, yuqoridagi \"Yuborish\" yoki \"Bekor qilish\" tugmasini bosing."),
    );
  }
}

/**
 * Notifications (typing indicators, confirmation texts) are best-effort — a
 * flaky Telegram API call must never block the underlying DB state change
 * (session transition, application creation) that's the actual point of the
 * interaction.
 */
async function notify(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logger.warn(`Telegram onboarding: ${label} failed: ${error}`);
  }
}

async function handleCallbackQuery(organizationId: string, token: string, callback: TelegramCallbackQuery): Promise<void> {
  const chatId = callback.message ? String(callback.message.chat.id) : null;
  if (!chatId) return;

  const session = await prisma.telegramOnboardingSession.findUnique({
    where: { organizationId_chatId: { organizationId, chatId } },
  });
  if (!session || session.step !== STEP.AWAITING_CONFIRM) {
    await notify("answerCallbackQuery", () => bot.answerCallbackQuery(token, callback.id));
    return;
  }

  if (callback.data === "cancel") {
    await prisma.telegramOnboardingSession.delete({ where: { organizationId_chatId: { organizationId, chatId } } });
    await notify("answerCallbackQuery", () => bot.answerCallbackQuery(token, callback.id));
    await notify("sendMessage", () => bot.sendMessage(token, chatId, "Bekor qilindi. Qayta boshlash uchun /start bosing."));
    return;
  }

  if (callback.data === "submit") {
    await notify("answerCallbackQuery", () => bot.answerCallbackQuery(token, callback.id, "Yuborilmoqda..."));

    let photoUrl: string | undefined;
    if (session.photoFileId) {
      try {
        const filePath = await bot.getFilePath(token, session.photoFileId);
        const buffer = await bot.downloadFile(token, filePath);
        photoUrl = saveApplicationPhoto(buffer);
      } catch (error) {
        logger.warn(`Telegram onboarding: failed to download photo for chat ${chatId}: ${error}`);
      }
    }

    await prisma.employeeApplication.create({
      data: {
        organizationId,
        fullName: session.fullName ?? "",
        phone: session.phone,
        photoUrl,
        telegramUserId: session.telegramUserId ?? "",
        telegramChatId: chatId,
        telegramUsername: session.telegramUsername,
      },
    });
    await prisma.telegramOnboardingSession.delete({ where: { organizationId_chatId: { organizationId, chatId } } });
    await notify("sendMessage", () =>
      bot.sendMessage(token, chatId, "Arizangiz qabul qilindi! Administrator tasdiqlashini kuting."),
    );
  }
}
