import bcrypt from "bcrypt";
import ms from "../../common/ms";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { ApiError } from "../../common/api-error";
import { recordAuditLog } from "../../common/audit-log";
import { signAccessToken, signRefreshToken, signTwoFactorChallenge, verifyRefreshToken } from "./jwt.util";
import { hashToken } from "./token-hash.util";
import { LoginDto } from "./auth.dto";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export type LoginResult =
  | (TokenPair & { user: { id: string; fullName: string; email: string; role: string } })
  | { twoFactorRequired: true; challengeToken: string };

export async function issueTokenPair(user: {
  id: string;
  role: "SUPER_ADMIN" | "ORG_ADMIN" | "STAFF";
  organizationId: string | null;
}): Promise<TokenPair> {
  const accessToken = signAccessToken({ sub: user.id, role: user.role, organizationId: user.organizationId });
  const refreshToken = signRefreshToken({ sub: user.id });

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + ms(env.JWT_REFRESH_EXPIRES_IN)),
    },
  });

  return { accessToken, refreshToken };
}

export async function login(dto: LoginDto, ipAddress: string | null = null): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });

  if (!user || user.deletedAt || !user.isActive) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
  if (!passwordMatches) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  if (user.twoFactorEnabled) {
    return { twoFactorRequired: true, challengeToken: signTwoFactorChallenge(user.id) };
  }

  const tokens = await issueTokenPair(user);

  await recordAuditLog({
    organizationId: user.organizationId,
    userId: user.id,
    action: "LOGIN",
    ipAddress,
  });

  return {
    ...tokens,
    user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role },
  };
}

export async function refresh(refreshToken: string): Promise<TokenPair> {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.userId !== payload.sub) {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.deletedAt || !user.isActive) {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  return issueTokenPair(user);
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

export async function logout(refreshToken: string, ipAddress: string | null = null): Promise<void> {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { select: { id: true, organizationId: true } } },
  });

  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (stored) {
    await recordAuditLog({
      organizationId: stored.user.organizationId,
      userId: stored.user.id,
      action: "LOGOUT",
      ipAddress,
    });
  }
}
