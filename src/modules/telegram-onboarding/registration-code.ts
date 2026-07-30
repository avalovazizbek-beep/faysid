import { randomBytes } from "node:crypto";
import { prisma } from "../../config/prisma";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

function randomCode(length = 5): string {
  return Array.from(randomBytes(length))
    .map((byte) => LETTERS[byte % LETTERS.length])
    .join("");
}

function todayDateOnly(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Ensures the organization has a registration code generated for today —
 * used both by the daily regeneration cron and immediately when an admin
 * first configures a bot token (so there's always a current code to hand
 * out, without waiting for the next cron run).
 */
export async function ensureTodaysRegistrationCode(organizationId: string): Promise<string> {
  const today = todayDateOnly();
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { telegramRegistrationCode: true, telegramRegistrationCodeDate: true },
  });

  const alreadyCurrent =
    org.telegramRegistrationCode && org.telegramRegistrationCodeDate?.getTime() === today.getTime();
  if (alreadyCurrent) {
    return org.telegramRegistrationCode!;
  }

  const code = randomCode();
  await prisma.organization.update({
    where: { id: organizationId },
    data: { telegramRegistrationCode: code, telegramRegistrationCodeDate: today },
  });
  return code;
}
