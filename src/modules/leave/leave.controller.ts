import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendCreated, sendSuccess } from "../../common/api-response";
import * as leaveService from "./leave.service";

export const createLeaveHandler = asyncHandler(async (req: Request, res: Response) => {
  const leave = await leaveService.createLeave(req.tenantId!, req.body);
  sendCreated(res, leave);
});

export const listLeavesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, pagination } = await leaveService.listLeaves(req.tenantId!, req.query as Record<string, string>);
  sendSuccess(res, items, 200, pagination);
});

export const approveLeaveHandler = asyncHandler(async (req: Request, res: Response) => {
  const leave = await leaveService.approveLeave(req.tenantId!, req.params.id, req.user!.sub);
  sendSuccess(res, leave);
});

export const rejectLeaveHandler = asyncHandler(async (req: Request, res: Response) => {
  const leave = await leaveService.rejectLeave(req.tenantId!, req.params.id, req.user!.sub);
  sendSuccess(res, leave);
});

export const deleteLeaveHandler = asyncHandler(async (req: Request, res: Response) => {
  await leaveService.deleteLeave(req.tenantId!, req.params.id);
  sendSuccess(res, { message: "Leave request deleted" });
});
