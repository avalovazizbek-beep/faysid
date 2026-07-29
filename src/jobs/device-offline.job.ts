import cron from "node-cron";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";

const OFFLINE_THRESHOLD_MS = 5 * 60_000;

/** Flags devices OFFLINE if they haven't heartbeated/reconnected within the threshold. */
export async function runDeviceOfflineCheck(): Promise<void> {
  const cutoff = new Date(Date.now() - OFFLINE_THRESHOLD_MS);

  const result = await prisma.device.updateMany({
    where: {
      deletedAt: null,
      status: "ONLINE",
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }],
    },
    data: { status: "OFFLINE" },
  });

  if (result.count > 0) {
    logger.info(`Marked ${result.count} device(s) OFFLINE (no heartbeat in ${OFFLINE_THRESHOLD_MS / 60_000} min)`);
  }
}

export function startDeviceOfflineCron(): void {
  // Runs every minute — cheap query, and offline detection should be near-real-time.
  cron.schedule("* * * * *", () => {
    runDeviceOfflineCheck().catch((error) => logger.error(`Device offline check failed: ${error}`));
  });
  logger.info("Device offline cron scheduled (every minute)");
}
