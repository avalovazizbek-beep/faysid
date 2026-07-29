import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as authService from "./auth.service";

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body, req.ip ?? null);
  sendSuccess(res, result);
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.refresh(req.body.refreshToken);
  sendSuccess(res, result);
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.body.refreshToken, req.ip ?? null);
  sendSuccess(res, { message: "Logged out" });
});

export const getMeHandler = asyncHandler(async (req: Request, res: Response) => {
  const me = await authService.getMe(req.user!.sub);
  sendSuccess(res, me);
});
