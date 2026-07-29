import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as calendarService from "./calendar.service";
import { CalendarQuery } from "./calendar.dto";

export const getCalendarHandler = asyncHandler(async (req: Request, res: Response) => {
  const { month, year } = req.query as unknown as CalendarQuery;
  const calendar = await calendarService.getCalendar(req.tenantId!, month, year);
  sendSuccess(res, calendar);
});
