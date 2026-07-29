import cron from "node-cron";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { sendTelegramDocument } from "../common/telegram";
import { getDailyAttendanceReport, dailyReportToExcel, dailyReportToPdf } from "../modules/reports/daily-report.service";

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Generates today's daily attendance report and sends it (Excel + PDF) to every organization with a configured Telegram chat. */
export async function runDailyReportJob(): Promise<void> {
  const date = startOfToday();
  const dateLabel = date.toISOString().slice(0, 10);

  const organizations = await prisma.organization.findMany({
    where: { deletedAt: null, telegramChatId: { not: null } },
    select: { id: true, name: true, telegramChatId: true },
  });

  for (const organization of organizations) {
    try {
      const rows = await getDailyAttendanceReport(organization.id, date);
      const [excelBuffer, pdfBuffer] = await Promise.all([
        dailyReportToExcel(rows),
        dailyReportToPdf(rows, date),
      ]);

      await sendTelegramDocument(
        organization.telegramChatId!,
        excelBuffer,
        `Davomat_${dateLabel}.xlsx`,
        `${organization.name} — Davomat hisoboti ${dateLabel}`,
      );
      await sendTelegramDocument(organization.telegramChatId!, pdfBuffer, `Davomat_${dateLabel}.pdf`);

      logger.info(`Daily report sent to organization ${organization.name} (${organization.id})`);
    } catch (error) {
      logger.error(`Daily report failed for organization ${organization.id}: ${error}`);
    }
  }
}

export function startDailyReportCron(): void {
  cron.schedule(
    "0 21 * * *",
    () => {
      runDailyReportJob().catch((error) => logger.error(`Daily report job failed: ${error}`));
    },
    { timezone: "Asia/Tashkent" },
  );
  logger.info("Daily report cron scheduled (21:00 Asia/Tashkent)");
}
