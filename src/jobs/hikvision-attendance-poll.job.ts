import cron from "node-cron";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { decryptSecret } from "../common/secret-crypto";
import { searchAcsEvents } from "../modules/device/hikvision-isapi";
import { recordDeviceAttendanceEvent } from "../modules/hikvision-webhook/attendance-recorder";

const INITIAL_LOOKBACK_MS = 5 * 60_000;

/**
 * Fallback attendance capture: instead of waiting for the device to push
 * events via its HTTP Listening webhook (which may never be configured
 * correctly on a given device/firmware), actively pull its access-control
 * event log over ISAPI. Runs independently of whether the webhook ever
 * fires — whichever path delivers an event first "wins" (the attendance
 * service's check-in/check-out conflict is harmless idempotent noise if
 * both eventually see the same event).
 */
export async function runHikvisionAttendancePoll(): Promise<void> {
  const devices = await prisma.device.findMany({
    where: { deletedAt: null, vendor: "HIKVISION", isapiUsername: { not: null }, isapiPasswordEnc: { not: null } },
  });

  for (const device of devices) {
    if (!device.isapiUsername || !device.isapiPasswordEnc) continue;

    const endTime = new Date();
    const startTime = device.lastPolledEventAt ?? new Date(endTime.getTime() - INITIAL_LOOKBACK_MS);

    try {
      const target = {
        ipAddress: device.ipAddress,
        port: device.port,
        isapiUsername: device.isapiUsername,
        isapiPassword: decryptSecret(device.isapiPasswordEnc),
      };
      const events = await searchAcsEvents(target, startTime, endTime);

      // A single physical scan can produce more than one identical log entry
      // on the device (e.g. a "verify" and a "door open" record for the same
      // instant). Without deduping, two same-timestamp entries for one
      // employee would flip check-in -> check-out on the very same scan when
      // direction has to be inferred (see attendance-recorder.ts). Keep only
      // the first entry per (employeeNo, time) pair.
      const seen = new Set<string>();
      const deduped = events.filter((event) => {
        const key = `${event.employeeNo}|${event.time}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      for (const event of deduped) {
        await recordDeviceAttendanceEvent(device, event.employeeNo, event.attendanceStatus, "poll");
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
