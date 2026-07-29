import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendCreated, sendSuccess } from "../../common/api-response";
import * as attendanceService from "./attendance.service";

export const checkInHandler = asyncHandler(async (req: Request, res: Response) => {
  const attendance = await attendanceService.checkIn(req.tenantId!, req.body);
  sendCreated(res, attendance);
});

export const checkOutHandler = asyncHandler(async (req: Request, res: Response) => {
  const attendance = await attendanceService.checkOut(req.tenantId!, req.body);
  sendSuccess(res, attendance);
});

export const listAttendanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, pagination } = await attendanceService.listAttendance(req.tenantId!, req.query as Record<string, string>);
  sendSuccess(res, items, 200, pagination);
});
