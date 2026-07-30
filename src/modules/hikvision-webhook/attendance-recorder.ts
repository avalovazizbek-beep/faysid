import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { recordAuditLog } from "../../common/audit-log";
import { checkIn, checkOut } from "../attendance/attendance.service";

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Shared employee-match + check-in/check-out logic used by both the push
 * webhook (hikvision-webhook.service.ts) and the ISAPI attendance-polling
 * fallback (jobs/hikvision-attendance-poll.job.ts) — the device's own event
 * shape differs between the two delivery paths, but once we have a device +
 * employeeNo + attendanceStatus, what happens next is identical.
 */
export async function recordDeviceAttendanceEvent(
  device: { id: string; organizationId: string },
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

  const status = attendanceStatus.toLowerCase();
  let isCheckOut = status.includes("out");
  let isCheckIn = status.includes("in");

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
