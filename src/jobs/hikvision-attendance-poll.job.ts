import cron from "node-cron";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { decryptSecret } from "../common/secret-crypto";
import { searchAcsEvents, type HikvisionAttendanceEvent } from "../modules/device/hikvision-isapi";
import * as hikConnect from "../modules/hikconnect/hikconnect-api";
import { getHikConnectCredentials as getPlatformHikConnectCredentials } from "../modules/platform-settings/platform-settings.service";
import { getOrgHikConnectCredentials } from "../modules/device/device-hikconnect.service";
import { recordDeviceAttendanceEvent } from "../modules/hikvision-webhook/attendance-recorder";

const INITIAL_LOOKBACK_MS = 5 * 60_000;

function dedupe(events: HikvisionAttendanceEvent[]): HikvisionAttendanceEvent[] {
  // A single physical scan can produce more than one identical log entry on
  // the device (e.g. a "verify" and a "door open" record for the same
  // instant). Without deduping, two same-timestamp entries for one employee
  // would flip check-in -> check-out on the very same scan when direction has
  // to be inferred (see attendance-recorder.ts). Keep only the first entry
  // per (employeeNo, time) pair.
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.employeeNo}|${event.time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Fallback attendance capture: instead of waiting for the device to push
 * events via its HTTP Listening webhook (which may never be configured
 * correctly on a given device/firmware), actively pulls its access-control
 * event log — via Hik-Connect cloud proxypass when the device is bound to
 * one, else direct ISAPI. Runs independently of whether the webhook ever
 * fires — whichever path delivers an event first "wins" (the attendance
 * service's check-in/check-out conflict is harmless idempotent noise if
 * both eventually see the same event).
 */
export async function runHikvisionAttendancePoll(): Promise<void> {
  const devices = await prisma.device.findMany({
    where: {
      deletedAt: null,
      vendor: "HIKVISION",
      OR: [{ hikConnectDeviceId: { not: null } }, { isapiUsername: { not: null }, isapiPasswordEnc: { not: null } }],
    },
  });
  if (devices.length === 0) return;

  for (const device of devices) {
    const endTime = new Date();
    const startTime = device.lastPolledEventAt ?? new Date(endTime.getTime() - INITIAL_LOOKBACK_MS);

    try {
      let events: HikvisionAttendanceEvent[];
      // Each device can belong to a different organization, each with its own
      // Hik-Connect account, so credentials are resolved per-device (org's own
      // account first, then Super Admin's platform-wide account) rather than
      // once for the whole batch. hikconnect-api.ts already caches the login
      // token per appKey, so this costs nothing extra beyond the first poll.
      const hikConnectCredentials = device.hikConnectDeviceId
        ? ((await getOrgHikConnectCredentials(device.organizationId)) ?? (await getPlatformHikConnectCredentials()))
        : null;
      if (device.hikConnectDeviceId && hikConnectCredentials) {
        events = await hikConnect.searchDeviceEvents(hikConnectCredentials, device.hikConnectDeviceId, startTime, endTime);
      } else if (device.isapiUsername && device.isapiPasswordEnc) {
        const target = {
          ipAddress: device.ipAddress,
          port: device.port,
          isapiUsername: device.isapiUsername,
          isapiPassword: decryptSecret(device.isapiPasswordEnc),
        };
        events = await searchAcsEvents(target, startTime, endTime);
      } else {
        continue;
      }

      const deduped = dedupe(events);

      // Live verification snapshots (the exact camera capture for each event)
      // are only available via Hik-Connect's cloud certificaterecords API,
      // correlated by AcsEvent's own serialNo — matches the confirmed-live
      // standalone bot's approach. Direct-ISAPI devices fall back to the
      // employee's stored profile photo inside notifyTelegramAttendance().
      let snapshots: Map<string, string> | null = null;
      if (device.hikConnectDeviceId && hikConnectCredentials && deduped.length > 0) {
        try {
          snapshots = await hikConnect.searchCertificateSnapshots(hikConnectCredentials, device.hikConnectDeviceId, startTime, endTime);
        } catch (error) {
          logger.warn(`${device.name}: could not fetch verification snapshots: ${error}`);
        }
      }

      for (const event of deduped) {
        const snapshotUrl = event.serialNo ? snapshots?.get(event.serialNo) : undefined;
        await recordDeviceAttendanceEvent(device, event.employeeNo, event.attendanceStatus, "poll", { snapshotUrl });
      }

      if (deduped.length > 0) {
        logger.info(`Hikvision attendance poll: processed ${deduped.length} event(s) for device ${device.id}`);
      }

      await prisma.device.update({ where: { id: device.id }, data: { lastPolledEventAt: endTime } });
    } catch (error) {
      logger.warn(`Hikvision attendance poll failed for device ${device.id}: ${error}`);
    }
  }
}

export function startHikvisionAttendancePollCron(): void {
  cron.schedule("*/20 * * * * *", () => {
    runHikvisionAttendancePoll().catch((error) => logger.error(`Hikvision attendance poll cron failed: ${error}`));
  });
  logger.info("Hikvision attendance poll scheduled (every 20s)");
}
