import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as twoFactorService from "./two-factor.service";

export const setupTwoFactorHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await twoFactorService.setupTwoFactor(req.user!.sub);
  sendSuccess(res, result);
});

export const enableTwoFactorHandler = asyncHandler(async (req: Request, res: Response) => {
  await twoFactorService.enableTwoFactor(req.user!.sub, req.body.code);
  sendSuccess(res, { message: "2FA yoqildi" });
});

export const disableTwoFactorHandler = asyncHandler(async (req: Request, res: Response) => {
  await twoFactorService.disableTwoFactor(req.user!.sub, req.body.code);
  sendSuccess(res, { message: "2FA o'chirildi" });
});

export const verifyTwoFactorHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await twoFactorService.verifyTwoFactorChallengeAndLogin(req.body.challengeToken, req.body.code);
  sendSuccess(res, result);
});
