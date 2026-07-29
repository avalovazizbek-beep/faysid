import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { checkIn, checkOut } from "../attendance/attendance.service";

/**
 * Best-effort parser for Hikvision's ISAPI "AccessControllerEvent" HTTP Listening
 * notification. Field names/nesting vary across models and firmware, so this reads
 * leniently and logs the full raw payload — the exact shape can only be confirmed
 * once a real device fires a real event, so expect to adjust this after the first
 * live delivery.
 */
interface ParsedHikvisionEvent {
  employeeNo: string | null;
  attendanceStatus: string;
  dateTime: Date;
  deviceIdentifiers: string[];
}

function parseEventObject(raw: unknown): ParsedHikvisionEvent {
  const eventObj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const accessEvent = (eventObj.AccessControllerEvent && typeof eventObj.AccessControllerEvent === "object"
    ? eventObj.AccessControllerEvent
    : eventObj) as Record<string, unknown>;

  const employeeNo =
    (accessEvent.employeeNoString as string | undefined) ??
    (accessEvent.employeeNo as string | undefined) ??
    (accessEvent.cardNo as string | undefined) ??
    null;

  const attendanceStatus = String(
    accessEvent.attendanceStatus ?? accessEvent.attendanceType ?? accessEvent.eventDescription ?? "",
  ).toLowerCase();

  const dateTime = eventObj.dateTime ? new Date(String(eventObj.dateTime)) : new Date();

  const deviceIdentifiers = [eventObj.macAddress, eventObj.deviceID, eventObj.serialNumber, eventObj.ipAddress]
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  return { employeeNo, attendanceStatus, dateTime, deviceIdentifiers };
}

function extractRawEvent(body: Record<string, unknown>, files: Express.Multer.File[]): unknown {
  // Multipart delivery: Hikvision typically sends a text field literally named
  // "event_log" containing the JSON (occasionally XML) payload.
  const eventLogField = body.event_log ?? body.eventLog;
  if (typeof eventLogField === "string") {
    try {
      return JSON.parse(eventLogField);
    } catch {
      logger.warn(`Hikvision webhook: event_log field is not valid JSON, raw: ${eventLogField.slice(0, 500)}`);
      return {};
    }
  }
  // Non-multipart JSON delivery: express.json() already parsed the whole body.
  if (Object.keys(body).length > 0) return body;
  return { _filesOnly: files.map((f) => f.fieldname) };
}

async function findMatchingDevice(identifiers: string[]) {
  if (identifiers.length > 0) {
    const device = await prisma.device.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { macAddress: { in: identifiers } },
          { serialNumber: { in: identifiers } },
          { ipAddress: { in: identifiers } },
        ],
      },
    });
    if (device) return device;
  }

  // Bootstrapping fallback: with only one device on the whole platform so far,
  // an unmatched event almost certainly still belongs to it.
  const allDevices = await prisma.device.findMany({ where: { deletedAt: null }, take: 2 });
  if (allDevices.length === 1) {
    logger.warn(`Hikvision webhook: no identifier match, falling back to the platform's only device (${allDevices[0].id})`);
    return allDevices[0];
  }
  return null;
}

export async function processHikvisionEvent(body: Record<string, unknown>, files: Express.Multer.File[]): Promise<void> {
  const raw = extractRawEvent(body, files);
  logger.info(`Hikvision webhook received: ${JSON.stringify(raw).slice(0, 2000)}`);

  const parsed = parseEventObject(raw);
  const device = await findMatchingDevice(parsed.deviceIdentifiers);

  if (!device) {
    logger.warn(`Hikvision webhook: could not match any device for identifiers ${JSON.stringify(parsed.deviceIdentifiers)}`);
    return;
  }

  await prisma.device.update({ where: { id: device.id }, data: { status: "ONLINE", lastSeenAt: new Date() } });

  if (!parsed.employeeNo) {
    logger.warn(`Hikvision webhook: event from device ${device.id} has no employee identifier — ${JSON.stringify(raw).slice(0, 500)}`);
    return;
  }

  const employee = await prisma.employee.findFirst({
    where: {
      organizationId: device.organizationId,
      deletedAt: null,
      OR: [{ employeeCode: parsed.employeeNo }, { cardNumber: parsed.employeeNo }],
    },
  });

  if (!employee) {
    logger.warn(
      `Hikvision webhook: no employee matches device ID "${parsed.employeeNo}" in organization ${device.organizationId}`,
    );
    return;
  }

  const isCheckOut = parsed.attendanceStatus.includes("out");
  const isCheckIn = parsed.attendanceStatus.includes("in");

  try {
    if (isCheckOut) {
      await checkOut(device.organizationId, { employeeId: employee.id });
      logger.info(`Hikvision webhook: recorded check-out for employee ${employee.id} via device ${device.id}`);
    } else if (isCheckIn) {
      await checkIn(device.organizationId, { employeeId: employee.id, type: "FACE" });
      logger.info(`Hikvision webhook: recorded check-in for employee ${employee.id} via device ${device.id}`);
    } else {
      logger.warn(`Hikvision webhook: unrecognized attendanceStatus "${parsed.attendanceStatus}" — event logged, no action taken`);
    }
  } catch (error) {
    // Devices fire many events per day (including redundant re-reads); an
    // "already checked in/out" conflict from the underlying attendance service
    // is expected noise here, not a real failure — log and move on.
    logger.info(`Hikvision webhook: attendance update skipped for employee ${employee.id}: ${error}`);
  }
}
