import cron from "node-cron";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { ensureTodaysRegistrationCode } from "../modules/telegram-onboarding/registration-code";

/** Regenerates today's employee-registration code for every organization with an onboarding bot configured. */
export async function runTelegramRegistrationCodeJob(): Promise<void> {
  const organizations = await prisma.organization.findMany({
    where: { deletedAt: null, telegramBotTokenEnc: { not: null } },
    select: { id: true, name: true },
  });

  for (const organization of organizations) {
    try {
      await ensureTodaysRegistrationCode(organization.id);
    } catch (error) {
      logger.error(`Telegram registration code regeneration failed for organization ${organization.id}: ${error}`);
    }
  }
}

export function startTelegramRegistrationCodeCron(): void {
  cron.schedule(
    "5 0 * * *",
    () => {
      runTelegramRegistrationCodeJob().catch((error) => logger.error(`Telegram registration code cron failed: ${error}`));
    },
    { timezone: "Asia/Tashkent" },
  );
  logger.info("Telegram registration code cron scheduled (00:05 Asia/Tashkent)");
}
