import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { encryptSecret, decryptSecret } from "../../common/secret-crypto";
import * as hikConnect from "../hikconnect/hikconnect-api";
import { UpdatePlatformSettingsDto } from "./platform-settings.dto";

/** The single settings row is always id=1 — created on first read/write. */
async function ensureRow() {
  return prisma.platformSettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
}

export async function getPlatformSettings() {
  const row = await ensureRow();
  return {
    hikConnectAppKey: row.hikConnectAppKey,
    hasHikConnectSecret: Boolean(row.hikConnectAppSecretEnc),
    hikConnectRegion: row.hikConnectRegion,
  };
}

export async function updatePlatformSettings(dto: UpdatePlatformSettingsDto) {
  await ensureRow();

  const data: { hikConnectAppKey?: string | null; hikConnectAppSecretEnc?: string | null; hikConnectRegion?: string | null } = {};
  if (dto.hikConnectAppKey !== undefined) data.hikConnectAppKey = dto.hikConnectAppKey;
  if (dto.hikConnectRegion !== undefined) data.hikConnectRegion = dto.hikConnectRegion;
  if (dto.hikConnectAppSecret !== undefined) {
    data.hikConnectAppSecretEnc = dto.hikConnectAppSecret ? encryptSecret(dto.hikConnectAppSecret) : null;
  }

  if (Object.keys(data).length > 0) {
    await prisma.platformSettings.update({ where: { id: 1 }, data });
  }

  return getPlatformSettings();
}

/** Reads the platform-wide Hik-Connect credentials — used by device.service.ts and the poll jobs. */
export async function getHikConnectCredentials(): Promise<hikConnect.HikConnectCredentials | null> {
  const row = await ensureRow();
  if (!row.hikConnectAppKey || !row.hikConnectAppSecretEnc) return null;
  return {
    appKey: row.hikConnectAppKey,
    appSecret: decryptSecret(row.hikConnectAppSecretEnc),
    region: row.hikConnectRegion,
  };
}

async function requireHikConnectCredentials(): Promise<hikConnect.HikConnectCredentials> {
  const credentials = await getHikConnectCredentials();
  if (!credentials) {
    throw ApiError.badRequest("Hik-Connect AppKey va AppSecret to'liq kiritilmagan");
  }
  return credentials;
}

export async function testHikConnect() {
  return hikConnect.testConnection(await requireHikConnectCredentials());
}

/**
 * Every access-control terminal in the platform-wide Hik-Connect account,
 * annotated with which Organization (if any) it's currently assigned to —
 * Super Admin's "which raw device belongs to which client" screen. Only
 * Super Admin sees the raw cloud list; an org's own admins only ever see
 * devices already assigned to them (via the normal Devices page), so one
 * organization can never browse or bind another's terminal.
 */
export async function listHikConnectDevicesWithAssignment() {
  const credentials = await requireHikConnectCredentials();
  const cloudDevices = await hikConnect.listAccessDevices(credentials);

  const boundDevices = await prisma.device.findMany({
    where: { hikConnectDeviceId: { in: cloudDevices.map((d) => d.id) } },
    select: { id: true, hikConnectDeviceId: true, organizationId: true, organization: { select: { name: true } } },
  });
  const boundByHikId = new Map(boundDevices.map((d) => [d.hikConnectDeviceId as string, d]));

  return cloudDevices.map((cloudDevice) => {
    const bound = boundByHikId.get(cloudDevice.id);
    return {
      ...cloudDevice,
      assignment: bound ? { deviceId: bound.id, organizationId: bound.organizationId, organizationName: bound.organization.name } : null,
    };
  });
}

/**
 * Assigns (or re-assigns) one raw Hik-Connect device to an Organization —
 * creates the org's Device row if this is the first assignment, or moves an
 * existing one if it was previously assigned elsewhere. Verifies the
 * hikConnectDeviceId is real (looked up from the cloud account, not just
 * trusted from the request) before writing anything.
 */
export async function assignHikConnectDevice(hikConnectDeviceId: string, organizationId: string, name?: string) {
  const credentials = await requireHikConnectCredentials();
  const cloudDevices = await hikConnect.listAccessDevices(credentials);
  const cloudDevice = cloudDevices.find((d) => d.id === hikConnectDeviceId);
  if (!cloudDevice) {
    throw ApiError.notFound("Bu ID bilan Hik-Connect qurilma topilmadi");
  }

  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) {
    throw ApiError.notFound("Tashkilot topilmadi");
  }

  const deviceName = name?.trim() || cloudDevice.name || cloudDevice.serialNo || "Hik-Connect qurilma";
  const existing = await prisma.device.findFirst({ where: { hikConnectDeviceId } });

  if (existing) {
    return prisma.device.update({
      where: { id: existing.id },
      data: { organizationId, name: deviceName, deletedAt: null },
    });
  }

  return prisma.device.create({
    data: {
      organizationId,
      name: deviceName,
      vendor: "HIKVISION",
      ipAddress: cloudDevice.serialNo || "0.0.0.0",
      port: 80,
      serialNumber: cloudDevice.serialNo,
      hikConnectDeviceId,
    },
  });
}

/** Unbinds a Hik-Connect device from whichever org's Device row currently holds it, without deleting that device's own history. */
export async function unassignHikConnectDevice(hikConnectDeviceId: string) {
  const existing = await prisma.device.findFirst({ where: { hikConnectDeviceId } });
  if (!existing) return;
  await prisma.device.update({ where: { id: existing.id }, data: { hikConnectDeviceId: null } });
}
