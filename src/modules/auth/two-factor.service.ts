import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { recordAuditLog } from "../../common/audit-log";
import { issueTokenPair, TokenPair } from "./auth.service";
import { verifyTwoFactorChallenge } from "./jwt.util";
import { buildOtpAuthUrl, buildQrCodeDataUrl, generateTwoFactorSecret, verifyTwoFactorToken } from "./two-factor.util";

export async function setupTwoFactor(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const secret = generateTwoFactorSecret();
  await prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret, twoFactorEnabled: false } });

  const otpauthUrl = buildOtpAuthUrl(user.email, secret);
  const qrCodeDataUrl = await buildQrCodeDataUrl(otpauthUrl);

  return { secret, otpauthUrl, qrCodeDataUrl };
}

export async function enableTwoFactor(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (!user.twoFactorSecret) {
    throw ApiError.badRequest("Avval /auth/2fa/setup orqali sozlashni boshlang");
  }
  if (!verifyTwoFactorToken(user.twoFactorSecret, code)) {
    throw ApiError.badRequest("Kod noto'g'ri");
  }

  await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  await recordAuditLog({ organizationId: user.organizationId, userId, action: "2FA_ENABLED" });
}

export async function disableTwoFactor(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw ApiError.badRequest("2FA yoqilmagan");
  }
  if (!verifyTwoFactorToken(user.twoFactorSecret, code)) {
    throw ApiError.badRequest("Kod noto'g'ri");
  }

  await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
  await recordAuditLog({ organizationId: user.organizationId, userId, action: "2FA_DISABLED" });
}

export async function verifyTwoFactorChallengeAndLogin(
  challengeToken: string,
  code: string,
): Promise<TokenPair & { user: { id: string; fullName: string; email: string; role: string } }> {
  let userId: string;
  try {
    userId = verifyTwoFactorChallenge(challengeToken).sub;
  } catch {
    throw ApiError.unauthorized("Challenge muddati tugagan, qaytadan kiring");
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    throw ApiError.badRequest("2FA yoqilmagan");
  }
  if (!verifyTwoFactorToken(user.twoFactorSecret, code)) {
    throw ApiError.badRequest("Kod noto'g'ri");
  }

  const tokens = await issueTokenPair(user);

  await recordAuditLog({ organizationId: user.organizationId, userId: user.id, action: "LOGIN" });

  return { ...tokens, user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role } };
}
