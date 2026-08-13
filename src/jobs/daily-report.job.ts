import cron from "node-cron";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { resolveNotifyBotToken, sendTelegramDocument, warnNoBotToken } from "../common/telegram";
import { getDailyAttendanceReport, dailyReportToExcel, dailyReportToPdf } from "../modules/reports/daily-report.service";

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Current Asia/Tashkent (UTC+5, no DST) wall-clock time as "HH:mm". */
function currentTashkentTime(): string {
  const tashkent = new Date(Date.now() + 5 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(tashkent.getUTCHours())}:${pad(tashkent.getUTCMinutes())}`;
}

const DEFAULT_DAILY_REPORT_TIME = "18:00";

/**
 * Sends each device's own daily attendance report (Excel + PDF), scoped to
 * just the employees synced to that device, to that device's own Telegram
 * group — at that device's own configured time (Device.dailyReportTime,
 * default "18:00"), not one fixed time for the whole platform. Runs every
 * minute (like device-offline.job.ts) and only acts on devices whose
 * configured time matches the current minute and haven't already been sent
 * today (dailyReportLastSentDate guards against double-sending within the
 * same minute-window or a slow run).
 */
export async function runDailyReportJob(): Promise<void> {
  const date = startOfToday();
  const dateLabel = date.toISOString().slice(0, 10);
  const currentTime = currentTashkentTime();

  const devices = await prisma.device.findMany({
    where: { deletedAt: null, telegramChatId: { not: null } },
    include: { organization: { select: { name: true } } },
  });

  const due = devices.filter((device) => {
    const alreadySentToday = device.dailyReportLastSentDate?.getTime() === date.getTime();
    return !alreadySentToday && (device.dailyReportTime ?? DEFAULT_DAILY_REPORT_TIME) === currentTime;
  });
  if (due.length === 0) return;

  for (const device of due) {
    try {
      const token = await resolveNotifyBotToken(device.organizationId);
      if (!token) {
        warnNoBotToken("daily report", device.telegramChatId!);
        continue;
      }

      const rows = await getDailyAttendanceReport(device.organizationId, date, device.id);
      const [excelBuffer, pdfBuffer] = await Promise.all([dailyReportToExcel(rows), dailyReportToPdf(rows, date)]);

      await sendTelegramDocument(
        token,
        device.telegramChatId!,
        excelBuffer,
        `Davomat_${dateLabel}.xlsx`,
        `${device.organization.name} — ${device.name} — Davomat hisoboti ${dateLabel}`,
      );
      await sendTelegramDocument(token, device.telegramChatId!, pdfBuffer, `Davomat_${dateLabel}.pdf`);

      await prisma.device.update({ where: { id: device.id }, data: { dailyReportLastSentDate: date } });
      logger.info(`Daily report sent for device ${device.name} (${device.id})`);
    } catch (error) {
      logger.error(`Daily report failed for device ${device.id}: ${error}`);
    }
  }
}

export function startDailyReportCron(): void {
  cron.schedule("* * * * *", () => {
    runDailyReportJob().catch((error) => logger.error(`Daily report job failed: ${error}`));
  });
  logger.info("Daily report cron scheduled (checks every minute against each device's own send time)");
}
