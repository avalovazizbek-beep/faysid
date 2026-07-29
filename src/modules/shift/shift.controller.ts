import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendCreated, sendSuccess } from "../../common/api-response";
import * as shiftService from "./shift.service";

export const createShiftHandler = asyncHandler(async (req: Request, res: Response) => {
  const shift = await shiftService.createShift(req.tenantId!, req.body);
  sendCreated(res, shift);
});

export const listShiftsHandler = asyncHandler(async (req: Request, res: Response) => {
  const shifts = await shiftService.listShifts(req.tenantId!);
  sendSuccess(res, shifts);
});

export const updateShiftHandler = asyncHandler(async (req: Request, res: Response) => {
  const shift = await shiftService.updateShift(req.tenantId!, req.params.id, req.body);
  sendSuccess(res, shift);
});

export const deleteShiftHandler = asyncHandler(async (req: Request, res: Response) => {
  await shiftService.deleteShift(req.tenantId!, req.params.id);
  sendSuccess(res, { message: "Shift deleted" });
});
