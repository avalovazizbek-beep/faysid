import cron from "node-cron";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { checkOut } from "../modules/attendance/attendance.service";
import { notifyTelegramAttendance } from "../modules/hikvision-webhook/attendance-recorder";
import { resolveShiftOccurrence } from "../modules/shift/shift-window.util";

/** How long after a shift's scheduled end to wait before treating the last-seen
 * scan as the real departure — matches the org's chosen debounce/grace value. */
const FINALIZE_GRACE_MS = 15 * 60_000;

/** Safety net for employees with no assigned shift: with no scheduled end to
 * anchor on, close an open session once there has been no activity at all for
 * this long, so no session is ever left open forever. */
const NO_SHIFT_IDLE_MS = 12 * 60 * 60_000;

/**
 * Closes out attendance sessions that are still open (checked in, not checked
 * out) once their shift has genuinely ended — using the employee's true
 * last-seen scan (lastSeenAt, recorded by attendance-recorder.ts's
 * touchOpenSession() on every mid-shift re-scan) as the real check-out time,
 * not "now". This is the counterpart to attendance-recorder.ts's silent
 * mid-shift touches: together they turn "every scan is a potential
 * keldi/chiqdi" into "exactly one keldi, exactly one chiqdi per shift".
 */
export async function runAttendanceShiftFinalize(): Promise<void> {
  const now = new Date();

  const openSessions = await prisma.attendance.findMany({
    where: { deletedAt: null, checkInAt: { not: null }, checkOutAt: null },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          photoUrl: true,
          shift: { select: { startTime: true, endTime: true } },
        },
      },
      device: { select: { id: true, name: true, telegramChatId: true, organizationId: true } },
    },
  });

  for (const session of openSessions) {
    try {
      let shouldFinalize: boolean;

      if (session.employee.shift) {
        const { scheduledEnd } = resolveShiftOccurrence(session.employee.shift, session.date);
        shouldFinalize = now.getTime() >= scheduledEnd.getTime() + FINALIZE_GRACE_MS;
      } else {
        // No shift assigned — fall back to a generous idle timeout anchored on
        // whatever real activity we last saw (a re-scan if any, else the
        // original check-in itself).
        const reference = session.lastSeenAt ?? session.checkInAt!;
        shouldFinalize = now.getTime() - reference.getTime() >= NO_SHIFT_IDLE_MS;
      }

      if (!shouldFinalize) continue;

      const finalAt = session.lastSeenAt ?? session.checkInAt!;
      const finalPhoto = session.lastSeenPhotoUrl ?? session.checkInPhotoUrl ?? undefined;

      await checkOut(session.organizationId, { employeeId: session.employeeId }, { photoUrl: finalPhoto, at: finalAt, sessionDate: session.date });

      logger.info(`Attendance finalize: closed session ${session.id} for employee ${session.employeeId} (last seen ${finalAt.toISOString()})`);

      if (session.device) {
        await notifyTelegramAttendance(
          {
            id: session.device.id,
            name: session.device.name,
            organizationId: session.device.organizationId,
            telegramChatId: session.device.telegramChatId,
          } as { name?: string; organizationId: string; telegramChatId?: string | null },
          { fullName: session.employee.fullName, photoUrl: session.employee.photoUrl },
          true,
          { localPath: finalPhoto },
        );
      }
    } catch (error) {
      logger.warn(`Attendance finalize failed for attendance ${session.id}: ${error}`);
    }
  }
}

export function startAttendanceShiftFinalizeCron(): void {
  cron.schedule("*/5 * * * *", () => {
    runAttendanceShiftFinalize().catch((error) => logger.error(`Attendance shift finalize cron failed: ${error}`));
  });
  logger.info("Attendance shift finalize scheduled (every 5 minutes)");
}
