import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as superAdminDashboardService from "./super-admin-dashboard.service";

export const getSuperAdminDashboardStatsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await superAdminDashboardService.getSuperAdminDashboardStats();
  sendSuccess(res, stats);
});
