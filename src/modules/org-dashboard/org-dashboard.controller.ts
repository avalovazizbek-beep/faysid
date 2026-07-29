import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as orgDashboardService from "./org-dashboard.service";
import { AttendanceRange } from "./org-dashboard.service";

const VALID_RANGES: AttendanceRange[] = ["daily", "weekly", "monthly", "yearly"];

export const getOrgDashboardStatsHandler = asyncHandler(async (req: Request, res: Response) => {
  const rangeParam = req.query.range as string | undefined;
  const range: AttendanceRange = VALID_RANGES.includes(rangeParam as AttendanceRange)
    ? (rangeParam as AttendanceRange)
    : "daily";

  const stats = await orgDashboardService.getOrgDashboardStats(req.tenantId!, range);
  sendSuccess(res, stats);
});
