import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendCreated, sendSuccess } from "../../common/api-response";
import * as holidayService from "./holiday.service";

export const createHolidayHandler = asyncHandler(async (req: Request, res: Response) => {
  const holiday = await holidayService.createHoliday(req.tenantId!, req.body);
  sendCreated(res, holiday);
});

export const listHolidaysHandler = asyncHandler(async (req: Request, res: Response) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const holidays = await holidayService.listHolidays(req.tenantId!, year);
  sendSuccess(res, holidays);
});

export const deleteHolidayHandler = asyncHandler(async (req: Request, res: Response) => {
  await holidayService.deleteHoliday(req.tenantId!, req.params.id);
  sendSuccess(res, { message: "Holiday deleted" });
});
