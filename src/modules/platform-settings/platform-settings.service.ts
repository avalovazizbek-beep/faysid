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

export async function testHikConnect() {
  const credentials = await getHikConnectCredentials();
  if (!credentials) {
    throw ApiError.badRequest("Hik-Connect AppKey va AppSecret to'liq kiritilmagan");
  }

  return hikConnect.testConnection(credentials);
}
