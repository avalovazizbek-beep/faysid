import cron from "node-cron";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { decryptSecret } from "../common/secret-crypto";
import { fetchDeviceInfo } from "../modules/device/hikvision-isapi";

/**
 * Actively probes every Hikvision device that has ISAPI credentials configured,
 * so status flips to ONLINE the moment the device becomes network-reachable
 * (e.g. right after enabling port-forwarding) — without anyone clicking
 * "Reconnect" by hand. device-offline.job.ts still handles flipping back to
 * OFFLINE when a device stops responding.
 */
export async function runHikvisionPoll(): Promise<void> {
  const devices = await prisma.device.findMany({
    where: { deletedAt: null, vendor: "HIKVISION", isapiUsername: { not: null }, isapiPasswordEnc: { not: null } },
  });

  for (const device of devices) {
    if (!device.isapiUsername || !device.isapiPasswordEnc) continue;
    try {
      await fetchDeviceInfo({
        ipAddress: device.ipAddress,
        port: device.port,
        isapiUsername: device.isapiUsername,
        isapiPassword: decryptSecret(device.isapiPasswordEnc),
      });
      await prisma.device.update({ where: { id: device.id }, data: { status: "ONLINE", lastSeenAt: new Date() } });
    } catch (error) {
      logger.warn(`Hikvision poll: device ${device.id} unreachable: ${error}`);
    }
  }
}

export function startHikvisionPollCron(): void {
  cron.schedule("*/30 * * * * *", () => {
    runHikvisionPoll().catch((error) => logger.error(`Hikvision poll cron failed: ${error}`));
  });
  logger.info("Hikvision ISAPI connectivity poll scheduled (every 30s)");
}
