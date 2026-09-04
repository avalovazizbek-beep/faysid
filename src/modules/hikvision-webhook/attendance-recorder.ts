import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { recordAuditLog } from "../../common/audit-log";
import { resolveNotifyBotToken, sendTelegramMessage, sendTelegramPhoto, sendTelegramPhotoByUrl, warnNoBotToken } from "../../common/telegram";
import { formatTashkentTime } from "../../common/tashkent-time";
import { resolveAttendanceSession } from "../shift/shift-window.util";
import { checkIn, checkOut, touchOpenSession } from "../attendance/attendance.service";

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
 * Photo priority: `photo.cloudUrl` (the event's own live verification
 * snapshot — a Hik-Connect cloud URL, still fresh right after the scan) when
 * available, else `photo.localPath` (an already-downloaded local copy — used
 * by the shift-finalize job, whose "chiqdi" can fire well after the original
 * cloud URL's own validity window), else the employee's stored FaceHub
 * profile photo, else text-only.
 */
export async function notifyTelegramAttendance(
  device: { name?: string; organizationId: string; telegramChatId?: string | null },
  employee: { fullName: string; photoUrl: string | null },
  isCheckOut: boolean,
  photo?: { cloudUrl?: string; localPath?: string },
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

    if (photo?.cloudUrl) {
      try {
        await sendTelegramPhotoByUrl(token, chatId, photo.cloudUrl, caption);
        return;
      } catch (error) {
        logger.warn(`Telegram attendance notification: snapshot send failed, falling back: ${error}`);
      }
    }

    const localSource = photo?.localPath ?? employee.photoUrl;
    const photoBuffer = localSource ? await readEmployeePhoto(localSource) : null;
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
 *
 * Direction model: single-door face terminals (the normal case for this
 * deployment) never report an explicit "in"/"out" direction — every verified
 * event looks identical. For those, direction is NOT inferred from
 * open/closed session state (that toggles on every re-scan, causing
 * "keldi"/"chiqdi" to flip-flop on a single continuous presence). Instead:
 *   - no open session yet for the resolved shift occurrence -> real check-in,
 *     notify once ("keldi").
 *   - a session is already open -> silently record "still present"
 *     (touchOpenSession), no notification. The shift is only closed
 *     ("chiqdi") by the scheduled finalize job
 *     (jobs/attendance-shift-finalize.job.ts), using the true last-seen scan.
 * Devices that DO report an explicit direction (or are pinned via
 * Device.attendanceDirection) keep the direct, single-transition-and-notify
 * behavior.
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
  options?: { skipTelegram?: boolean; snapshotUrl?: string; eventTime?: Date },
): Promise<void> {
  const employee = await prisma.employee.findFirst({
    where: {
      organizationId: device.organizationId,
      deletedAt: null,
      OR: [{ employeeCode: employeeNo }, { cardNumber: employeeNo }],
    },
    include: { shift: { select: { startTime: true, endTime: true, lateThresholdMinutes: true } } },
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

  const eventTime = options?.eventTime ?? new Date();
  const { sessionDate } = resolveAttendanceSession(employee.shift, eventTime);
  const localPhotoUrl = options?.snapshotUrl ? await downloadAndSaveSnapshot(options.snapshotUrl) : null;

  // Direction pinned on the device (dedicated entry-only/exit-only terminal),
  // or explicitly reported by this event — a real, single transition either way.
  let explicitDirection: "in" | "out" | null = null;
  if (device.attendanceDirection === "CHECK_IN_ONLY") explicitDirection = "in";
  else if (device.attendanceDirection === "CHECK_OUT_ONLY") explicitDirection = "out";
  else {
    const status = attendanceStatus.toLowerCase();
    if (status.includes("out")) explicitDirection = "out";
    else if (status.includes("in")) explicitDirection = "in";
  }

  try {
    if (explicitDirection === "out") {
      await checkOut(device.organizationId, { employeeId: employee.id }, { photoUrl: localPhotoUrl ?? undefined, at: eventTime, sessionDate });
      logger.info(`Hikvision ${source}: recorded check-out for employee ${employee.id} via device ${device.id}`);
      await recordAuditLog({
        organizationId: device.organizationId,
        action: "DEVICE_WEBHOOK_CHECKOUT",
        entityType: "Employee",
        entityId: employee.id,
        metadata: { source },
      });
      if (!options?.skipTelegram) await notifyTelegramAttendance(device, employee, true, { cloudUrl: options?.snapshotUrl });
      return;
    }

    if (explicitDirection === "in") {
      await checkIn(
        device.organizationId,
        { employeeId: employee.id, type: "FACE" },
        { photoUrl: localPhotoUrl ?? undefined, at: eventTime, sessionDate, deviceId: device.id },
      );
      logger.info(`Hikvision ${source}: recorded check-in for employee ${employee.id} via device ${device.id}`);
      await recordAuditLog({
        organizationId: device.organizationId,
        action: "DEVICE_WEBHOOK_CHECKIN",
        entityType: "Employee",
        entityId: employee.id,
        metadata: { source },
      });
      if (!options?.skipTelegram) await notifyTelegramAttendance(device, employee, false, { cloudUrl: options?.snapshotUrl });
      return;
    }

    // No explicit direction — the normal case for a plain face-recognition
    // access terminal. Resolve against the currently-open session instead of
    // guessing "in vs out" per event.
    const existing = await prisma.attendance.findFirst({
      where: { organizationId: device.organizationId, employeeId: employee.id, date: sessionDate },
    });

    if (!existing || existing.checkOutAt) {
      // First detection of this shift occurrence, or a genuine re-entry after
      // an earlier finalize/checkout — a real arrival.
      await checkIn(
        device.organizationId,
        { employeeId: employee.id, type: "FACE" },
        { photoUrl: localPhotoUrl ?? undefined, at: eventTime, sessionDate, deviceId: device.id },
      );
      logger.info(`Hikvision ${source}: recorded check-in for employee ${employee.id} via device ${device.id}`);
      await recordAuditLog({
        organizationId: device.organizationId,
        action: "DEVICE_WEBHOOK_CHECKIN",
        entityType: "Employee",
        entityId: employee.id,
        metadata: { source },
      });
      if (!options?.skipTelegram) await notifyTelegramAttendance(device, employee, false, { cloudUrl: options?.snapshotUrl });
    } else {
      // Session already open — a mid-shift re-scan. Record "still present"
      // silently; do not flip state or notify.
      const touched = await touchOpenSession(device.organizationId, employee.id, sessionDate, eventTime, localPhotoUrl ?? undefined, device.id);
      if (touched) {
        logger.info(`Hikvision ${source}: mid-shift re-scan for employee ${employee.id} — session still open, no notification`);
      }
    }
  } catch (error) {
    // Devices/polling can surface the same event more than once (redundant
    // re-reads, overlapping poll windows, or a race between the webhook and
    // poll paths both seeing the same scan) — an "already checked in/out"
    // conflict from the attendance service is expected noise, not a failure.
    logger.info(`Hikvision ${source}: attendance update skipped for employee ${employee.id}: ${error}`);
  }
}
