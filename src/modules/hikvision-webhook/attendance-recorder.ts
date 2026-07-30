import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { recordAuditLog } from "../../common/audit-log";
import { checkIn, checkOut } from "../attendance/attendance.service";

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
  const isCheckOut = status.includes("out");
  const isCheckIn = status.includes("in");

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
