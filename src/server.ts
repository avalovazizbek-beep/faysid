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
import { startTelegramRegistrationCodeCron } from "./jobs/telegram-registration-code.job";

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
  startTelegramRegistrationCodeCron();

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




