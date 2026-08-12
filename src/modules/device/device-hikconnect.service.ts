import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { encryptSecret, decryptSecret } from "../../common/secret-crypto";
import * as hikConnect from "../hikconnect/hikconnect-api";
import { UpdateHikConnectSettingsDto } from "./device-hikconnect.dto";

/**
 * Per-organization counterpart of platform-settings.service.ts's Hik-Connect
 * functions — lets an organization connect its own Hik-Connect for Teams
 * account directly from the Devices page, instead of relying on Super
 * Admin's platform-wide account + manual device assignment. Reuses the same
 * proven hikconnect-api.ts client (ported live from hikvistion/bot/hik_client.py)
 * — no new HTTP/API code, only a different credential scope.
 */

export async function getHikConnectSettings(organizationId: string) {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { hikConnectAppKey: true, hikConnectAppSecretEnc: true, hikConnectRegion: true },
  });
  if (!organization) {
    throw ApiError.notFound("Organization not found");
  }
  return {
    hikConnectAppKey: organization.hikConnectAppKey,
    hasHikConnectSecret: Boolean(organization.hikConnectAppSecretEnc),
    hikConnectRegion: organization.hikConnectRegion,
  };
}

export async function updateHikConnectSettings(organizationId: string, dto: UpdateHikConnectSettingsDto) {
  const data: { hikConnectAppKey?: string | null; hikConnectAppSecretEnc?: string | null; hikConnectRegion?: string | null } = {};
  if (dto.hikConnectAppKey !== undefined) data.hikConnectAppKey = dto.hikConnectAppKey;
  if (dto.hikConnectRegion !== undefined) data.hikConnectRegion = dto.hikConnectRegion;
  if (dto.hikConnectAppSecret !== undefined) {
    data.hikConnectAppSecretEnc = dto.hikConnectAppSecret ? encryptSecret(dto.hikConnectAppSecret) : null;
  }

  if (Object.keys(data).length > 0) {
    await prisma.organization.update({ where: { id: organizationId }, data });
  }

  return getHikConnectSettings(organizationId);
}

/** Reads this organization's own Hik-Connect credentials — used by device.service.ts and the poll job, org-scope takes priority over the platform-wide account. */
export async function getOrgHikConnectCredentials(organizationId: string): Promise<hikConnect.HikConnectCredentials | null> {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { hikConnectAppKey: true, hikConnectAppSecretEnc: true, hikConnectRegion: true },
  });
  if (!organization?.hikConnectAppKey || !organization.hikConnectAppSecretEnc) return null;
  return {
    appKey: organization.hikConnectAppKey,
    appSecret: decryptSecret(organization.hikConnectAppSecretEnc),
    region: organization.hikConnectRegion,
  };
}

async function requireOrgHikConnectCredentials(organizationId: string): Promise<hikConnect.HikConnectCredentials> {
  const credentials = await getOrgHikConnectCredentials(organizationId);
  if (!credentials) {
    throw ApiError.badRequest("Hik-Connect AppKey va AppSecret to'liq kiritilmagan");
  }
  return credentials;
}

export async function testHikConnect(organizationId: string) {
  return hikConnect.testConnection(await requireOrgHikConnectCredentials(organizationId));
}

/** Every terminal in this organization's own Hik-Connect account, flagged with which local Device row (if any) it's already connected to. */
export async function listCloudDevices(organizationId: string) {
  const credentials = await requireOrgHikConnectCredentials(organizationId);
  const cloudDevices = await hikConnect.listAccessDevices(credentials);

  const connectedDevices = await prisma.device.findMany({
    where: { organizationId, deletedAt: null, hikConnectDeviceId: { in: cloudDevices.map((d) => d.id) } },
    select: { id: true, hikConnectDeviceId: true },
  });
  const connectedByHikId = new Map(connectedDevices.map((d) => [d.hikConnectDeviceId as string, d.id]));

  return cloudDevices.map((cloudDevice) => ({
    ...cloudDevice,
    connectedDeviceId: connectedByHikId.get(cloudDevice.id) ?? null,
  }));
}

/**
 * Connects one raw Hik-Connect device (from this org's own account) into a
 * local Device row — creates it on first connect, or refreshes the name if
 * already connected. Verifies the hikConnectDeviceId is real (looked up from
 * the org's own cloud account) before writing anything, and refuses to
 * connect a device that's already claimed by a *different* organization.
 */
export async function connectCloudDevice(organizationId: string, hikConnectDeviceId: string, name?: string) {
  const credentials = await requireOrgHikConnectCredentials(organizationId);
  const cloudDevices = await hikConnect.listAccessDevices(credentials);
  const cloudDevice = cloudDevices.find((d) => d.id === hikConnectDeviceId);
  if (!cloudDevice) {
    throw ApiError.notFound("Bu ID bilan Hik-Connect qurilma topilmadi");
  }

  const deviceName = name?.trim() || cloudDevice.name || cloudDevice.serialNo || "Hik-Connect qurilma";
  const existing = await prisma.device.findFirst({ where: { organizationId, hikConnectDeviceId } });

  if (existing) {
    return prisma.device.update({ where: { id: existing.id }, data: { name: deviceName, deletedAt: null } });
  }

  // A physical device belongs to exactly one organization's own Hik-Connect
  // account in the normal case, so it should never already be connected
  // under a *different* organization — guard against two orgs' credentials
  // (accidentally or otherwise) resolving to the same device ID.
  const claimedElsewhere = await prisma.device.findFirst({ where: { hikConnectDeviceId, organizationId: { not: organizationId } } });
  if (claimedElsewhere) {
    throw ApiError.conflict("Bu qurilma allaqachon boshqa tashkilotga ulangan");
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
