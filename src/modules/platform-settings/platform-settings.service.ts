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
    hikConnectApiBaseUrl: row.hikConnectApiBaseUrl,
  };
}

export async function updatePlatformSettings(dto: UpdatePlatformSettingsDto) {
  await ensureRow();

  const data: { hikConnectAppKey?: string | null; hikConnectAppSecretEnc?: string | null; hikConnectApiBaseUrl?: string | null } =
    {};
  if (dto.hikConnectAppKey !== undefined) data.hikConnectAppKey = dto.hikConnectAppKey;
  if (dto.hikConnectApiBaseUrl !== undefined) data.hikConnectApiBaseUrl = dto.hikConnectApiBaseUrl;
  if (dto.hikConnectAppSecret !== undefined) {
    data.hikConnectAppSecretEnc = dto.hikConnectAppSecret ? encryptSecret(dto.hikConnectAppSecret) : null;
  }

  if (Object.keys(data).length > 0) {
    await prisma.platformSettings.update({ where: { id: 1 }, data });
  }

  return getPlatformSettings();
}

export async function testHikConnect() {
  const row = await ensureRow();
  if (!row.hikConnectAppKey || !row.hikConnectAppSecretEnc || !row.hikConnectApiBaseUrl) {
    throw ApiError.badRequest("Hik-Connect AppKey, AppSecret va API manzili to'liq kiritilmagan");
  }

  return hikConnect.testConnection({
    appKey: row.hikConnectAppKey,
    appSecret: decryptSecret(row.hikConnectAppSecretEnc),
    apiBaseUrl: row.hikConnectApiBaseUrl,
  });
}
