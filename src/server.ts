import dns from "node:dns";
import { createServer } from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { prisma } from "./config/prisma";
import { redis } from "./config/redis";
import { initSocket } from "./config/socket";
import { startLicenseExpiryCron } from "./jobs/license-expiry.job";
import { startDeviceOfflineCron } from "./jobs/device-offline.job";
import { startDailyReportCron } from "./jobs/daily-report.job";
import { startHikvisionPollCron } from "./jobs/hikvision-poll.job";
import { startHikvisionAttendancePollCron } from "./jobs/hikvision-attendance-poll.job";
import { startTelegramRegistrationCodeCron } from "./jobs/telegram-registration-code.job";
import { registerTelegramBotWebhook } from "./modules/telegram-bot/telegram-bot.service";

// Some VPS hosts advertise an IPv6 route for outbound domains (Telegram,
// Hik-Connect, ...) that doesn't actually work — Node's fetch (undici) tries
// it before IPv4 and eats the full connect timeout on every request
// (confirmed live: AggregateError [ETIMEDOUT] from internalConnectMultiple,
// while `curl` to the same host succeeded instantly since it prefers IPv4).
// Forcing IPv4-first here fixes every outbound fetch() call app-wide.
dns.setDefaultResultOrder("ipv4first");

async function bootstrap(): Promise<void> {
  await prisma.$connect();

  // Redis backs BullMQ features that aren't wired up yet — don't block
  // server startup on it, just log so it's visible once those features land.
  try {
    await redis.connect();
  } catch (error) {
    logger.warn(`Redis unavailable, continuing without it: ${error instanceof Error ? error.message : error}`);
  }

  startLicenseExpiryCron();
  startDeviceOfflineCron();
  startDailyReportCron();
  startHikvisionPollCron();
  startHikvisionAttendancePollCron();
  startTelegramRegistrationCodeCron();
  await registerTelegramBotWebhook();

  const app = createApp();
  const httpServer = createServer(app);
  initSocket(httpServer);

  const server = httpServer.listen(env.PORT, () => {
    logger.info(`FaceHub ERP backend listening on port ${env.PORT} (${env.NODE_ENV})`);
    logger.info(`Swagger docs available at http://localhost:${env.PORT}/api/docs`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(async () => {
      await prisma.$disconnect();
      redis.disconnect();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((error) => {
  logger.error("Failed to start server", error);
  process.exit(1);
});




