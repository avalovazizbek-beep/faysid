import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as auditLogService from "./audit-log.service";

export const listAuditLogsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, pagination } = await auditLogService.listAuditLogs(req.query as Record<string, string>);
  sendSuccess(res, items, 200, pagination);
});
