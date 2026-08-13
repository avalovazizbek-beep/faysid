import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { recordAuditLog } from "../../common/audit-log";
import { resolveNotifyBotToken, sendTelegramMessage, sendTelegramPhoto, sendTelegramPhotoByUrl, warnNoBotToken } from "../../common/telegram";
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
 * Downloads a Hik-Connect cloud snapshot URL and saves it as a permanent
 * local copy (/uploads/attendance/) — the cloud URL is only used once here
 * (and once by Telegram's own fetch for the real-time notification); a
 * daily report generated hours later needs its own stable copy since that
 * cloud URL isn't guaranteed to still resolve by then.
 */
async function downloadAndSaveSnapshot(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn(`Attendance snapshot download failed (${response.status}): ${url}`);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const dir = path.join(__dirname, "..", "..", "..", "uploads", "attendance");
    mkdirSync(dir, { recursive: true });
    const filename = `${randomUUID()}.jpg`;
    writeFileSync(path.join(dir, filename), buffer);
    return `/uploads/attendance/${filename}`;
  } catch (error) {
    logger.warn(`Attendance snapshot download failed: ${error}`);
    return null;
  }
}

/**
 * Real-time "xodim keldi/ketdi" notification — sent to the device's own bound
 * Telegram group (Device.telegramChatId) when it has one, otherwise falls
 * back to the organization's default chat (org.telegramChatId — the same
 * destination as the 18:00 daily report). Best-effort: a failure here must
 * never undo the attendance record that was already successfully saved.
 *
 * Photo priority: the event's own live verification snapshot (snapshotUrl —
 * the exact camera capture from that scan, matching the old standalone bot's
 * behavior) when available, else the employee's stored FaceHub profile
 * photo, else text-only.
 */
async function notifyTelegramAttendance(
  device: { name?: string; organizationId: string; telegramChatId?: string | null },
  employee: { fullName: string; photoUrl: string | null },
  isCheckOut: boolean,
  snapshotUrl?: string,
): Promise<void> {
  try {
    let chatId = device.telegramChatId ?? null;
    if (!chatId) {
      const org = await prisma.organization.findUnique({ where: { id: device.organizationId }, select: { telegramChatId: true } });
      chatId = org?.telegramChatId ?? null;
    }
    if (!chatId) return;

    const token = await resolveNotifyBotToken(device.organizationId);
    if (!token) {
      warnNoBotToken("attendance notification", chatId);
      return;
    }

    const emoji = isCheckOut ? "🔴" : "🟢";
    const label = isCheckOut ? "Chiqdi" : "Keldi";
    const captionLines = [`${emoji} ${label}`, `👤 ${employee.fullName}`];
    if (device.name) captionLines.push(`📍 ${device.name}`);
    captionLines.push(`🕐 ${formatTashkentTime(new Date())}`);
    const caption = captionLines.join("\n");

    if (snapshotUrl) {
      try {
        await sendTelegramPhotoByUrl(token, chatId, snapshotUrl, caption);
        return;
      } catch (error) {
        logger.warn(`Telegram attendance notification: snapshot send failed, falling back: ${error}`);
      }
    }

    const photoBuffer = employee.photoUrl ? await readEmployeePhoto(employee.photoUrl) : null;
    if (photoBuffer) {
      await sendTelegramPhoto(token, chatId, photoBuffer, caption);
    } else {
      await sendTelegramMessage(token, chatId, caption);
    }
  } catch (error) {
    logger.warn(`Telegram attendance notification failed for organization ${device.organizationId}: ${error}`);
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
  device: {
    id: string;
    name?: string;
    organizationId: string;
    attendanceDirection?: "AUTO" | "CHECK_IN_ONLY" | "CHECK_OUT_ONLY";
    telegramChatId?: string | null;
  },
  employeeNo: string,
  attendanceStatus: string,
  source: "webhook" | "poll",
  options?: { skipTelegram?: boolean; snapshotUrl?: string },
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

  const localPhotoUrl = options?.snapshotUrl ? await downloadAndSaveSnapshot(options.snapshotUrl) : null;

  try {
    if (isCheckOut) {
      await checkOut(device.organizationId, { employeeId: employee.id }, localPhotoUrl ?? undefined);
      logger.info(`Hikvision ${source}: recorded check-out for employee ${employee.id} via device ${device.id}`);
      await recordAuditLog({
        organizationId: device.organizationId,
        action: "DEVICE_WEBHOOK_CHECKOUT",
        entityType: "Employee",
        entityId: employee.id,
        metadata: { source },
      });
      if (!options?.skipTelegram) await notifyTelegramAttendance(device, employee, true, options?.snapshotUrl);
    } else if (isCheckIn) {
      await checkIn(device.organizationId, { employeeId: employee.id, type: "FACE" }, localPhotoUrl ?? undefined);
      logger.info(`Hikvision ${source}: recorded check-in for employee ${employee.id} via device ${device.id}`);
      await recordAuditLog({
        organizationId: device.organizationId,
        action: "DEVICE_WEBHOOK_CHECKIN",
        entityType: "Employee",
        entityId: employee.id,
        metadata: { source },
      });
      if (!options?.skipTelegram) await notifyTelegramAttendance(device, employee, false, options?.snapshotUrl);
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
