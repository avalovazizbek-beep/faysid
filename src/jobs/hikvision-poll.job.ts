import cron from "node-cron";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { decryptSecret } from "../common/secret-crypto";
import { fetchDeviceInfo } from "../modules/device/hikvision-isapi";
import * as hikConnect from "../modules/hikconnect/hikconnect-api";
import { getHikConnectCredentials } from "../modules/platform-settings/platform-settings.service";

/**
 * Actively probes every Hikvision device bound to Hik-Connect or configured
 * with direct ISAPI credentials, so status flips to ONLINE the moment the
 * device becomes reachable — without anyone clicking "Reconnect" by hand.
 * device-offline.job.ts still handles flipping back to OFFLINE when a device
 * stops responding.
 */
export async function runHikvisionPoll(): Promise<void> {
  const devices = await prisma.device.findMany({
    where: {
      deletedAt: null,
      vendor: "HIKVISION",
      OR: [{ hikConnectDeviceId: { not: null } }, { isapiUsername: { not: null }, isapiPasswordEnc: { not: null } }],
    },
  });
  if (devices.length === 0) return;

  const hikConnectCredentials = await getHikConnectCredentials();

  for (const device of devices) {
    try {
      if (device.hikConnectDeviceId && hikConnectCredentials) {
        await hikConnect.fetchDeviceInfo(hikConnectCredentials, device.hikConnectDeviceId);
      } else if (device.isapiUsername && device.isapiPasswordEnc) {
        await fetchDeviceInfo({
          ipAddress: device.ipAddress,
          port: device.port,
          isapiUsername: device.isapiUsername,
          isapiPassword: decryptSecret(device.isapiPasswordEnc),
        });
      } else {
        continue;
      }
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
