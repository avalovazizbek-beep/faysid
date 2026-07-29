import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../../config/env";
import { AccessTokenPayload } from "./auth.types";

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  } as SignOptions);
}

export function signRefreshToken(payload: { sub: string }): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string };
}

const TWO_FACTOR_CHALLENGE_PURPOSE = "two_factor_challenge";

export function signTwoFactorChallenge(userId: string): string {
  return jwt.sign({ sub: userId, purpose: TWO_FACTOR_CHALLENGE_PURPOSE }, env.JWT_TWO_FACTOR_SECRET, {
    expiresIn: "5m",
  } as SignOptions);
}

export function verifyTwoFactorChallenge(token: string): { sub: string } {
  const payload = jwt.verify(token, env.JWT_TWO_FACTOR_SECRET) as { sub: string; purpose?: string };
  if (payload.purpose !== TWO_FACTOR_CHALLENGE_PURPOSE) {
    throw new Error("Invalid challenge token");
  }
  return { sub: payload.sub };
}
