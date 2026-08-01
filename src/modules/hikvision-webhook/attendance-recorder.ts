import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { recordAuditLog } from "../../common/audit-log";
import { sendTelegramMessage, sendTelegramPhoto } from "../../common/telegram";
import { checkIn, checkOut } from "../attendance/attendance.service";

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Renders a Date as Asia/Tashkent (UTC+5, no DST) wall-clock "HH:mm". */
function formatTashkentTime(date: Date): string {
  const tashkent = new Date(date.getTime() + 5 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(tashkent.getUTCHours())}:${pad(tashkent.getUTCMinutes())}`;
}

async function readEmployeePhoto(photoUrl: string): Promise<Buffer | null> {
  try {
    const relative = photoUrl.replace(/^\/uploads\//, "");
    const absolute = path.join(__dirname, "..", "..", "..", "uploads", relative);
    return await readFile(absolute);
  } catch (error) {
    logger.warn(`Telegram notification: could not read employee photo ${photoUrl}: ${error}`);
    return null;
  }
}

/**
 * Real-time "xodim keldi/ketdi" notification to the org's Telegram chat
 * (org.telegramChatId — the same destination as the 18:00 daily report).
 * Best-effort: a failure here must never undo the attendance record that was
 * already successfully saved.
 */
async function notifyTelegramAttendance(
  organizationId: string,
  employee: { fullName: string; photoUrl: string | null },
  isCheckOut: boolean,
): Promise<void> {
  try {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { telegramChatId: true } });
    if (!org?.telegramChatId) return;

    const emoji = isCheckOut ? "🔴" : "🟢";
    const label = isCheckOut ? "Chiqdi" : "Keldi";
    const caption = `${emoji} ${employee.fullName}\n${label}: ${formatTashkentTime(new Date())}`;

    const photoBuffer = employee.photoUrl ? await readEmployeePhoto(employee.photoUrl) : null;
    if (photoBuffer) {
      await sendTelegramPhoto(org.telegramChatId, photoBuffer, caption);
    } else {
      await sendTelegramMessage(org.telegramChatId, caption);
    }
  } catch (error) {
    logger.warn(`Telegram attendance notification failed for organization ${organizationId}: ${error}`);
  }
}

/**
 * Shared employee-match + check-in/check-out logic used by both the push
 * webhook (hikvision-webhook.service.ts) and the ISAPI attendance-polling
 * fallback (jobs/hikvision-attendance-poll.job.ts) — the device's own event
 * shape differs between the two delivery paths, but once we have a device +
 * employeeNo + attendanceStatus, what happens next is identical.
 */
export async function recordDeviceAttendanceEvent(
  device: { id: string; organizationId: string; attendanceDirection?: "AUTO" | "CHECK_IN_ONLY" | "CHECK_OUT_ONLY" },
  employeeNo: string,
  attendanceStatus: string,
  source: "webhook" | "poll",
): Promise<void> {
  const employee = await prisma.employee.findFirst({
    where: {
      organizationId: device.organizationId,
      deletedAt: null,
      OR: [{ employeeCode: employeeNo }, { cardNumber: employeeNo }],
    },
  });

  if (!employee) {
    logger.warn(
      `Hikvision ${source}: no employee matches device ID "${employeeNo}" in organization ${device.organizationId}`,
    );
    await recordAuditLog({
      organizationId: device.organizationId,
      action: "DEVICE_WEBHOOK_UNMATCHED_EMPLOYEE",
      entityType: "Device",
      entityId: device.id,
      metadata: { employeeNo, source },
    });
    return;
  }

  let isCheckOut: boolean;
  let isCheckIn: boolean;

  if (device.attendanceDirection === "CHECK_IN_ONLY") {
    isCheckIn = true;
    isCheckOut = false;
  } else if (device.attendanceDirection === "CHECK_OUT_ONLY") {
    isCheckOut = true;
    isCheckIn = false;
  } else {
    const status = attendanceStatus.toLowerCase();
    isCheckOut = status.includes("out");
    isCheckIn = status.includes("in");

    // Many single-door/standalone terminals (no separate entry/exit readers)
    // never report an explicit direction at all — every verified event looks
    // identical. When that's the case, infer direction the same way the
    // manual attendance toggle does: if the employee is currently "inside"
    // (checked in, not checked out today), this event must be a check-out.
    if (!isCheckOut && !isCheckIn) {
      const todayAttendance = await prisma.attendance.findUnique({
        where: { employeeId_date: { employeeId: employee.id, date: startOfToday() } },
      });
      if (todayAttendance?.checkInAt && !todayAttendance.checkOutAt) {
        isCheckOut = true;
      } else {
        isCheckIn = true;
      }
      logger.info(
        `Hikvision ${source}: attendanceStatus was empty/unrecognized ("${attendanceStatus}") — inferred ${
          isCheckOut ? "check-out" : "check-in"
        } from current session state for employee ${employee.id}`,
      );
    }
  }

  try {
    if (isCheckOut) {
      await checkOut(device.organizationId, { employeeId: employee.id });
      logger.info(`Hikvision ${source}: recorded check-out for employee ${employee.id} via device ${device.id}`);
      await recordAuditLog({
        organizationId: device.organizationId,
        action: "DEVICE_WEBHOOK_CHECKOUT",
        entityType: "Employee",
        entityId: employee.id,
        metadata: { source },
      });
      await notifyTelegramAttendance(device.organizationId, employee, true);
    } else if (isCheckIn) {
      await checkIn(device.organizationId, { employeeId: employee.id, type: "FACE" });
      logger.info(`Hikvision ${source}: recorded check-in for employee ${employee.id} via device ${device.id}`);
      await recordAuditLog({
        organizationId: device.organizationId,
        action: "DEVICE_WEBHOOK_CHECKIN",
        entityType: "Employee",
        entityId: employee.id,
        metadata: { source },
      });
      await notifyTelegramAttendance(device.organizationId, employee, false);
    } else {
      logger.warn(`Hikvision ${source}: unrecognized attendanceStatus "${attendanceStatus}" for employee ${employee.id}`);
    }
  } catch (error) {
    // Devices/polling can surface the same event more than once (redundant
    // re-reads, overlapping poll windows); an "already checked in/out"
    // conflict from the attendance service is expected noise, not a failure.
    logger.info(`Hikvision ${source}: attendance update skipped for employee ${employee.id}: ${error}`);
  }
}
