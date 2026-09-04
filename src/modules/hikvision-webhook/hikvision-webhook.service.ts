import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { recordAuditLog } from "../../common/audit-log";
import * as hikConnect from "../hikconnect/hikconnect-api";
import { getHikConnectCredentials as getPlatformHikConnectCredentials } from "../platform-settings/platform-settings.service";
import { getOrgHikConnectCredentials } from "../device/device-hikconnect.service";
import { recordDeviceAttendanceEvent } from "./attendance-recorder";

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
  /** ISAPI AcsEvent's own event serial number, if the push includes it — correlates
   * this event with its cloud-side verification snapshot (Hik-Connect
   * certificaterecords' devSerialNo), same as the poll path's searchDeviceEvents(). */
  serialNo: string | null;
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

  const serialNoRaw = accessEvent.serialNo ?? eventObj.serialNo;
  const serialNo = serialNoRaw !== undefined && serialNoRaw !== null ? String(serialNoRaw) : null;

  return { employeeNo, attendanceStatus, dateTime, deviceIdentifiers, serialNo };
}

/**
 * Best-effort lookup of this push event's own clean verification snapshot —
 * mirrors jobs/hikvision-attendance-poll.job.ts's approach (Hik-Connect cloud
 * certificaterecords/search, correlated by serialNo) so the fast real-time
 * webhook path carries the same quality photo the slower poll path already
 * did. Only possible for devices bound to Hik-Connect's cloud (hikConnectDeviceId
 * set) and pushes that include a serialNo; returns undefined otherwise so the
 * caller falls back to the employee's stored profile photo, same as before.
 */
async function fetchWebhookSnapshot(
  device: { organizationId: string; hikConnectDeviceId: string | null },
  serialNo: string | null,
  dateTime: Date,
): Promise<string | undefined> {
  if (!device.hikConnectDeviceId || !serialNo) return undefined;
  try {
    const credentials = (await getOrgHikConnectCredentials(device.organizationId)) ?? (await getPlatformHikConnectCredentials());
    if (!credentials) return undefined;
    const windowStart = new Date(dateTime.getTime() - 2 * 60_000);
    const windowEnd = new Date(dateTime.getTime() + 2 * 60_000);
    const snapshots = await hikConnect.searchCertificateSnapshots(credentials, device.hikConnectDeviceId, windowStart, windowEnd);
    return snapshots.get(serialNo);
  } catch (error) {
    logger.warn(`Hikvision webhook: could not fetch verification snapshot: ${error}`);
    return undefined;
  }
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
    await recordAuditLog({
      action: "DEVICE_WEBHOOK_UNMATCHED_DEVICE",
      metadata: { identifiers: parsed.deviceIdentifiers, raw: JSON.stringify(raw).slice(0, 1000) },
    });
    return;
  }

  await prisma.device.update({ where: { id: device.id }, data: { status: "ONLINE", lastSeenAt: new Date() } });
  await recordAuditLog({
    organizationId: device.organizationId,
    action: "DEVICE_WEBHOOK_RECEIVED",
    entityType: "Device",
    entityId: device.id,
    metadata: { employeeNo: parsed.employeeNo, attendanceStatus: parsed.attendanceStatus },
  });

  if (!parsed.employeeNo) {
    logger.warn(`Hikvision webhook: event from device ${device.id} has no employee identifier — ${JSON.stringify(raw).slice(0, 500)}`);
    return;
  }

  const snapshotUrl = await fetchWebhookSnapshot(device, parsed.serialNo, parsed.dateTime);

  await recordDeviceAttendanceEvent(device, parsed.employeeNo, parsed.attendanceStatus, "webhook", {
    eventTime: parsed.dateTime,
    snapshotUrl,
  });
}
